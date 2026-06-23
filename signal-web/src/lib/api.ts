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
  requestCount: number
  voteCount: number
  createdAt: string
}

export interface ProjectsPage {
  projects: Project[]
  nextCursor: string | null
}

interface ProjectsPageParams {
  cursor?: string
  limit?: number
  search?: string
  sort?: "newest" | "active"
}

function projectsQueryString(params: ProjectsPageParams): string {
  const qs = new URLSearchParams()
  if (params.cursor) qs.set("cursor", params.cursor)
  if (params.limit !== undefined) qs.set("limit", String(params.limit))
  if (params.search) qs.set("search", params.search)
  if (params.sort && params.sort !== "newest") qs.set("sort", params.sort)
  const query = qs.toString()
  return query ? `?${query}` : ""
}

export function listProjects(params: ProjectsPageParams = {}): Promise<ProjectsPage> {
  return request<ProjectsPage>(`/projects${projectsQueryString(params)}`)
}

export function listMyProjects(params: ProjectsPageParams = {}): Promise<ProjectsPage> {
  return request<ProjectsPage>(`/projects/mine${projectsQueryString(params)}`)
}

export interface ProjectInput {
  name: string
  description?: string
}

export function createProject(input: ProjectInput): Promise<{ project: Project }> {
  return request<{ project: Project }>("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function updateProject(id: string, input: ProjectInput): Promise<{ project: Project }> {
  return request<{ project: Project }>(`/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export function deleteProject(id: string): Promise<void> {
  return request<void>(`/projects/${id}`, { method: "DELETE" })
}

export function getProject(id: string): Promise<{ project: Project }> {
  return request<{ project: Project }>(`/projects/${id}`)
}

export interface FeatureRequest {
  id: string
  projectId: string
  title: string
  description: string | null
  status: string
  createdBy: string
  createdByName: string
  upvoteCount: number
  viewerHasVoted: boolean
  createdAt: string
}

export interface FeatureRequestsPage {
  featureRequests: FeatureRequest[]
  nextCursor: string | null
}

interface FeatureRequestsPageParams {
  cursor?: string
  limit?: number
  status?: string
  sort?: "votes" | "newest"
}

function featureRequestsQueryString(params: FeatureRequestsPageParams): string {
  const qs = new URLSearchParams()
  if (params.cursor) qs.set("cursor", params.cursor)
  if (params.limit !== undefined) qs.set("limit", String(params.limit))
  if (params.status) qs.set("status", params.status)
  if (params.sort && params.sort !== "votes") qs.set("sort", params.sort)
  const query = qs.toString()
  return query ? `?${query}` : ""
}

export function listFeatureRequests(
  projectId: string,
  params: FeatureRequestsPageParams = {}
): Promise<FeatureRequestsPage> {
  return request<FeatureRequestsPage>(
    `/projects/${projectId}/feature-requests${featureRequestsQueryString(params)}`
  )
}

export interface FeatureRequestInput {
  title: string
  description?: string
}

export function createFeatureRequest(
  projectId: string,
  input: FeatureRequestInput
): Promise<{ featureRequest: FeatureRequest }> {
  return request<{ featureRequest: FeatureRequest }>(`/projects/${projectId}/feature-requests`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function updateFeatureRequest(
  id: string,
  input: FeatureRequestInput
): Promise<{ featureRequest: FeatureRequest }> {
  return request<{ featureRequest: FeatureRequest }>(`/feature-requests/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export function deleteFeatureRequest(id: string): Promise<void> {
  return request<void>(`/feature-requests/${id}`, { method: "DELETE" })
}

export function voteFeatureRequest(id: string): Promise<{ featureRequest: FeatureRequest }> {
  return request<{ featureRequest: FeatureRequest }>(`/feature-requests/${id}/vote`, {
    method: "POST",
  })
}

export function unvoteFeatureRequest(id: string): Promise<{ featureRequest: FeatureRequest }> {
  return request<{ featureRequest: FeatureRequest }>(`/feature-requests/${id}/vote`, {
    method: "DELETE",
  })
}

export function updateFeatureRequestStatus(
  id: string,
  status: string
): Promise<{ featureRequest: FeatureRequest }> {
  return request<{ featureRequest: FeatureRequest }>(`/feature-requests/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  })
}
