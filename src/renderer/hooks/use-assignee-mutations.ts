import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { apiError } from '@/lib/mutation-errors'
import { mapTaskInCaches } from '@/lib/pending-cache'
import type { PersonRef, Task } from '@/lib/vikunja-types'

// Assigning and unassigning (cross-app semantics 9.2). `assignees` is never part of a task patch:
// each change is its own request, sent through the main process write gate, so offline it is queued
// and replayed in order. The change shows at once; a refusal puts it back and the global handler
// says why.

interface AssigneeVars {
  task: Pick<Task, 'id' | 'title'>
  person: PersonRef
  assign: boolean
}

function setAssigned(qc: QueryClient, taskId: number, person: PersonRef, assigned: boolean) {
  mapTaskInCaches(qc, taskId, (task) => {
    const others = (task.assignees ?? []).filter((a) => a.id !== person.id)
    return { ...task, assignees: assigned ? [...others, person] : others }
  })
}

export function useToggleAssignee() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'change who the task is assigned to' },
    mutationFn: async ({ task, person, assign }: AssigneeVars) => {
      const result = assign
        ? await api.addTaskAssigneeOrQueue(task.id, person, task.title)
        : await api.removeTaskAssigneeOrQueue(task.id, person, task.title)
      if (!result.success) throw apiError(result)
    },
    onMutate: async ({ task, person, assign }) => {
      // A list refetch that answers before the server has the change would show the old assignees.
      for (const key of ['tasks', 'view-tasks', 'section-tasks', 'task-detail']) await qc.cancelQueries({ queryKey: [key] })
      setAssigned(qc, task.id, person, assign)
    },
    onError: (_error, { task, person, assign }) => {
      setAssigned(qc, task.id, person, !assign)
    },
  })
}
