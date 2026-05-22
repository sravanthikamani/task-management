import axios from 'axios';

const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const DEFAULT_API_BASE_URL = isLocalHost
  ? 'http://localhost:5000/api'
  : 'https://task-management-5aro.onrender.com/api';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || DEFAULT_API_BASE_URL
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ewms_token') || sessionStorage.getItem('ewms_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
