import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true
});

export function apiErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    return data?.message ?? error.message;
  }

  return error instanceof Error ? error.message : "Something went wrong";
}

