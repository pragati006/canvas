export class ServiceError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
    this.status = status
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError
}

export function errorMessage(error: unknown): string {
  if (error instanceof ServiceError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Try again.'
}
