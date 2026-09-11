
/** Shared API origin. Import this module once from index.js so every axios call sends cookies. */
import axios from "axios";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
export const API_URL = `${BACKEND_URL}/api`;

axios.defaults.withCredentials = true;

export default axios;
