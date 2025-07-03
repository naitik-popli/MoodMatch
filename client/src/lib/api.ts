//export const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
// ? "http://localhost:5000/api"
// : `http://${window.location.hostname}:5000/api`;
export const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:5000/api"
  : "https://moodmatch-61xp.onrender.com/api";
