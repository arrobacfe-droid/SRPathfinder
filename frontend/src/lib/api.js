import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const sessionId = localStorage.getItem("session_id");
  if (sessionId) {
    config.headers["X-Session-Id"] = sessionId;
  }
  return config;
});

api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("session_id");
      localStorage.removeItem("user");
      if (!window.location.pathname.startsWith("/login") && !window.location.pathname.startsWith("/auth")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export default api;
