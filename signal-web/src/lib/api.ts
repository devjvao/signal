const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080"
const TOKEN_KEY = "signal_token"

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "ApiError"
  }
}

interface ErrorBody {
  error?: string
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers })
  const body: unknown = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = (body as ErrorBody).error ?? "request failed"
    throw new ApiError(response.status, message)
  }

  return body as T
}

export interface User {
  id: string
  name: string
  email: string
  createdAt: string
}

export function register(
  name: string,
  email: string,
  password: string
): Promise<{ user: User }> {
  return request<{ user: User }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  })
}

export function login(
  email: string,
  password: string
): Promise<{ token: string; user: User }> {
  return request<{ token: string; user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
}

export function getMe(): Promise<{ user: User }> {
  return request<{ user: User }>("/auth/me")
}

export interface Project {
  id: string
  name: string
  slug: string
  description: string | null
  ownerId: string
  ownerName: string
  createdAt: string
}

export interface ProjectsPage {
  projects: Project[]
  nextCursor: string | null
}

interface ProjectsPageParams {
  cursor?: string
  limit?: number
}

function projectsQueryString(params: ProjectsPageParams): string {
  const search = new URLSearchParams()
  if (params.cursor) search.set("cursor", params.cursor)
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  const query = search.toString()
  return query ? `?${query}` : ""
}

export function listProjects(params: ProjectsPageParams = {}): Promise<ProjectsPage> {
  return request<ProjectsPage>(`/projects${projectsQueryString(params)}`)
}

export function listMyProjects(params: ProjectsPageParams = {}): Promise<ProjectsPage> {
  return request<ProjectsPage>(`/projects/mine${projectsQueryString(params)}`)
}
