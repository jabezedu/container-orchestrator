export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4010';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('orchestrator_token');
}

export function setToken(token: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('orchestrator_token', token);
  }
}

export function removeToken() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('orchestrator_token');
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${API_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      removeToken();
      window.location.href = '/login';
    }
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || 'Unauthorized: Session expired');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed with status ${response.status}`);
  }

  return response.json();
}
