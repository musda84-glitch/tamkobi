export const resolveImageUrl = (url) => {
  if (!url) return null;
  if (url.startsWith("/api/")) return `${process.env.REACT_APP_BACKEND_URL}${url}`;
  return url;
};
