//export const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
// ? "http://localhost:5000/api"
// : `http://${window.location.hostname}:5000/api`;
// lib/api.ts
export const API_BASE_URL =
  process.env.NODE_ENV === "production"
    ? "https://moodmatch-61xp.onrender.com/"
    : "http://localhost:5000/api"; // or your dev backend
export const SOCKET_PATH = "/socket.io";