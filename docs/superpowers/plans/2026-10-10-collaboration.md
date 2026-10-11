# Household collaboration (Direction A): implementation plan

Source: the design handoff `design_handoff_collaboration/` (README, reference JSX for desktop and
Android). Both apps, one release. The contract text is `docs/cross-app-semantics-v1.md` section 9
and `docs/design-system-v1.md` section 4; the vectors are `collaboration` and the `comment.day`
date vectors in `test-fixtures/cross-app-semantics-v1.json`.

## 1. What the server really does (checked on the 2.4.0 test server, 2026-10-10)

Every endpoint in the handoff exists. Probing two users against `vicu-test-vikunja` changed or
sharpened these points:

| Handoff said | Server does | Plan |
|---|---|---|
| Mentions: check how the web app encodes them | Vikunja's editor writes `<mention-user data-id="maya" data-label="Maya">`; the server's Markdown import writes the same element with `@maya` inside. A comment with plain `<p>@maya</p>` creates **no** notification; the element does (`task.comment`, `mentioned: true`). | Write the element (with `@username` inside, like the server). Read both forms. |
| Shared = `shares + teams > 0` | A subproject of a shared project has empty `users` and `teams` lists but the parent's people can see it (`users/search` lists them, `max_permission` 1). | Shared = `users/search` (empty `q`) lists someone who is not you. |
| `PATCH projects/{id}/users/{username}` | The spec and server use `PUT` with `{permission}`. | `PUT`. |
| `POST tasks/{id}/assignees/bulk` | It is `PUT ... /bulk`. | Not used (single add/remove only). |
| `expand=comment_count,is_unread` | Comma form answers 422; the parameter must be repeated. `is_unread` and a zero count are left out of the answer. | Repeat `expand`; absent means false / 0. |
| `is_unread` raised by mentions | Raised for every member but the author on **any** new comment; not by an assignment. | Unread dot = "new comments since you last opened". |
| Read-only members cannot be assigned | The server accepts it (only the caller needs write). | UI rule only: disabled with "Can view only". |
| Comment edit | `PATCH` with a merge patch works; author only (403 for anyone else). | Merge patch `{comment}`. |
| Notify me | Subscribe twice: 412 code 12002. Assigning someone subscribes them. | 412 counts as done. |
| Errors | Assign twice: 400 code 4021. Unassign: idempotent 204. Share again / owner: 409 code 7002. Unknown user: 404 code 1005. Missing comment: 404 code 4015. Read-only member commenting: 403. | Classified in both offline queues. |
| Avatars | `avatar/{username}` answers SVG for the default initials provider, `no-store`. | Desktop: main fetches bytes, data URL, session cache. Android: Coil through the `localhost` interceptor plus `coil-svg`. Initials fallback on a neutral fill. |
| `GET users?q=` | Exact username only (`uima` finds nothing). | Share button enabled on an exact match. |

Notification names on the server: `task.comment` (with `mentioned`) and `task.assigned`.

## 2. Answers to the open questions

1. **Mention encoding**: the `<mention-user data-id data-label>@username</mention-user>` element (above).
2. **Own avatar**: shown, as designed. In a shared project "assigned to me" and "unassigned" must
   look different; you come first in every list so your avatar is always the leftmost.
3. **"Assigned to me" custom-list filter**: not in this release. It needs a custom-list contract
   change (`custom-list-sync-v1.json`) in both apps; the server filter alone would not match the
   client evaluator.
4. **Comments on done tasks**: readable and writable (the server allows it; "done, receipt is in the
   drawer" is a real use).

Further decisions: comment day dividers get a new date context `comment.day` (Today, Yesterday,
weekday date); comment times use `logbook.time`. Comments with rich HTML from the web app are
shown as text and can be deleted but not edited, so formatting is never lost. Subscriptions and
"mark read" are online only. Notifications (phase 2) are out of this pass.

## 3. Contract (both repos, first)

- `docs/cross-app-semantics-v1.md`: section 8 gains `comment.day`; new section 9 Collaboration
  (members and shared rule, permissions, names, signals, comment HTML both ways, mention
  suggestions, offline rules, subscriptions and sharing, vectors).
- `docs/design-system-v1.md`: section 4 meta line (comment count) and trailing cluster (avatars
  first), avatar rules, unread mark, and the property order of the open task.
- `test-fixtures/cross-app-semantics-v1.json`: `comment.day` vectors; `collaboration` block
  (`shared`, `memberPermission`, `names`, `countLabel`, `encode`, `decode`, `mention`, `edited`).
- Identical bytes in `vicu-android`; `sibling-contract-identity` / `SharedContractIdentityTest` green.

## 4. Desktop (`vicu`)

1. **Shared rules** `src/shared/collaboration.ts` (pure): display name, ordering, name list,
   visible-to, labels, `isSharedProject`, `memberPermission`, `encodeCommentHtml`,
   `decodeCommentHtml` (small tokenizer), `isPlainComment`, `commentEditText`, `mentionQuery`,
   `mentionSuggestions`, `applyMention`, `isEdited`. `date-display.ts`: `comment.day`. Tests run the
   fixture vectors.
2. **API client** (`api-client.ts`): `searchProjectUsers`, `fetchProjectShares`, `fetchProjectTeams`,
   `shareProject`, `updateProjectShare`, `unshareProject`, `searchUsers`, `addAssignee`,
   `removeAssignee`, `fetchTaskComments(page)`, `createTaskComment`, `updateTaskComment`,
   `deleteTaskComment`, `markTaskRead`, `subscribeTask`, `unsubscribeTask`, `fetchAvatar`
   (binary). Projects are fetched with `expand=permissions`. Task lists add
   `expand=comment_count&expand=is_unread` while `collab` says something is shared
   (`api-v2.ts`, a Vicu-only `collab` flag set in main).
3. **Project access service** (`src/main/project-access.ts`, no Electron): members per project
   from `users/search`, 10 minute cache per server, one request per project with a small
   concurrency limit, kept on failure, invalidated after a share change; `hasSharedProject()` feeds
   the expand flag. IPC `get-project-access(projectIds)` returns members per project.
4. **IPC** (`handleTrusted`): the calls above. Assignee and comment writes go through `writeTask`
   (per task order, queue when unreachable or behind the queue) and `sendSerially`. Comment fetch
   overlays the offline queue (pending creates, edits, deletes) like Quick View's cache.
5. **Offline queue**: action types `add-assignee`, `remove-assignee`, `create-comment`,
   `update-comment`, `delete-comment` (entity `comment` for the last three) in types, parse,
   merge (cancel pairs, fold edits into a pending create, delete removes the create), replay,
   classify (4021 and 404-on-delete are done, 403 drops), summary, temp comment ids remapped after
   the create replays. Tests next to the existing ones.
6. **Renderer data**: types (`Task.assignees`, `comment_count`, `is_unread`, `subscription`;
   `Project.owner`, `max_permission`; `TaskComment`; `ProjectMember`), `api.ts`, hooks
   `use-current-user`, `use-project-access` (members, `isShared`, my permission),
   `use-project-shares`, `use-task-comments` (desc pages, oldest first), `use-assignee-mutations`,
   `use-comment-mutations`, `use-task-subscription`, `use-avatar`. Optimistic updates through
   `mapTaskInCaches`; `task-comments` persisted; replay handler refetches comments.
7. **Row**: `CommentCount` button on the meta line (after the paperclip), `AvatarStack` first in
   the trailing cluster; both only when the project is shared.
8. **Card bar**: Assign after Project (`AssignPopover`, listbox, toggles optimistically, stays
   open); Comments in the `ml-auto` group before More (toggles the pane, Mod+Shift+C).
9. **Comments pane**: third column in `AppShell` (352 px, `bg-sidebar`, `border-l`), sticky open
   state in `ui-store`, follows the open card, hidden for private projects, closes with the card;
   header (count, Notify toggle, close), Visible to line, day dividers, comments (own: Edit and
   Delete), composer (Mod+Enter, mention picker Popover, Escape), read on open, FLIP for new
   comments, reduced motion.
10. **Sharing**: "Share…" in `ProjectMenu` for admins, `ShareProjectDialog` in
    `ProjectActionsHost`, remove with Undo toast; sidebar `Users` icon with "Shared with ..." tooltip.
11. **Harness**: `lib.mjs` makes extra users (`uimaya` "Maya", `uisam` "Sam"); `seed.mjs` shares
    "Trip to Lisbon" (Maya can edit, Sam can view), assigns and comments (with a mention of the test
    user). Scenario `collab.mjs`: solo (unshared) look and no expand, shared chips, assign and
    unassign, a comment round trip with a mention, read clears the dot. Update `card-toolbar.mjs`
    only if the private order changes (it does not).
12. `npm run verify`, then `npm run ui:verify -- --scenario collab` (and the card and baseline ones).

## 5. Android (`vicu-android`)

1. **Contract**: same docs and fixture; `DateDisplay` gains `COMMENT_DAY`; `util/Collaboration.kt`
   (same functions as desktop) with `CollaborationFixtureTest`.
2. **DTOs and API**: `UserDto` stays; `TaskDto.assignees`, `commentCount`, `isUnread`,
   `subscription`; `ProjectDto.maxPermission`; `TaskCommentDto`, `ProjectUserDto`
   (`UserWithPermission`), `TeamWithPermissionDto`, `ShareUserDto`, `AssigneeDto`. Service calls
   for everything in 4.2; projects with `expand=permissions`; task lists with the two expands while
   something is shared. `assignees` joins `MergePatches.taskReadOnlyFields`.
3. **Room v4** (`MIGRATION_3_4`, `4.json`, migration test): `tasks.assigneesJson` (`'[]'`),
   `tasks.commentCount` (0), `tasks.isUnread` (0); `projects.maxPermission` (-1 = unknown); new
   tables `project_members` (projectId, userId, username, name, position) and `task_comments`
   (id, taskId, author fields, comment, created, updated, pending). `LocalDataDao` wipes them.
4. **Repository and queue**: `CollaborationRepository` (members refresh with a 10 minute
   staleness, shares, assign, comments, read, subscription, current user id from `TokenStorage`);
   pending actions `task/add_assignee`, `task/remove_assignee` (payload `{"user_id"}`) and
   `comment/create|update|delete` with folding rules, temp comment ids, replay branches in
   `SyncEngine`, failure codes; refresh protection for tasks with waiting assignee changes.
5. **UI**: `TaskItem` meta count (own 48 dp target, "Open comments") and avatars;
   `TaskRowSemantics` adds "assigned to ..." and "N comments, new"; editor chips Assign (after
   Project) and Comments (after attachments); `AssignSheet`; `TaskCommentsRoute(taskId)` with
   `TaskCommentsScreen` + ViewModel (IME-docked composer, mention `InputChip`s, long press
   Edit/Delete, read on open, draft kept with `rememberSaveable`); the editor overlay hides while
   the comments route is on top. "Shared with" in `ProjectEditDialog` through `ProjectActions`.
6. **Koin** wiring and `KoinGraphTest`; fakes for the new DAO methods.
7. Gate `./gradlew test lint assembleDebug`; `scripts/ui-verify` editor chip order for shared
   projects and `a11y.mjs --strict` on the new screens on `emulator-5554`.

## 6. Hand checks after both are done

1. A profile with no shared projects looks as before on both apps (and sends no expand).
2. Share a project from desktop, refresh Android: Assign and Comments appear on its tasks only.
3. Comment from Android with `@maya`: desktop signed in as Maya shows the blue count with a dot;
   opening the pane clears it on both.
4. A read-only member is disabled in Assign and has no composer.
5. Offline: assign and comment on both apps, reconnect: each reaches the server once, in order.
