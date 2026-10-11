export interface ApiSuccess<T> {
  success: true
  data: T
}

export interface ApiError {
  success: false
  error: string
  statusCode?: number
  errorCode?: number
  /**
   * The session works, but the API token it uses lacks the permission for this request (Vikunja
   * answers that with 401; cross-app semantics 9.7). Sent on as a 403 with a message that says so.
   */
  tokenPermission?: boolean
}

export type ApiResult<T> = ApiSuccess<T> | ApiError
