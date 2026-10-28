/**
 * 封面图的模糊缩略版（几百字节，直接写进页面）：国内访问 Vercel 时大图常常要等很久甚至下载失败，
 * 先垫这张，页面一打开就看得到小岛的样子，不会只剩一行替代文字。
 * 重拍 public/island/poster-*.webp 后要跟着重新生成：
 *   dwebp poster-wide.webp -o w.png && cwebp -q 40 -resize 64 40 w.png -o w.webp && base64 -i w.webp
 *   dwebp poster-tall.webp -o t.png && cwebp -q 40 -resize 36 64 t.png -o t.webp && base64 -i t.webp
 */
export const POSTER_LQIP = {
  wide: 'data:image/webp;base64,UklGRsgBAABXRUJQVlA4ILwBAACQCwCdASpAACgAPu1eqk2ppKQiKrgO+TAdiWwAs7NaQ6l8ilQZ7cY3cCsP9gmUBSht6C4sRJleIdgxVMoUqC00r8Ey8/zFMvWWUcOGvWe8HMAnYL0hh1XXCQj94zwdNM820ijBfADJmKfK1a3prC86M/2pqTVK9Vz1Pr5PVaHDEaemwPt+vU2PXx2tUocDuyRMcG0q2hLxiwWT55z+1CupIDF5q3r+u7nOJr17ndoxj7ReHSoapzptdR7xhD8uF7t1OvRuGnq+ZVD7PQWkOKw+Sgys5GkY5uEcTiBPjTes0v+WSrFTCFYYDgXnf+hNZn5NOJPT24MF24V/yXPWjSikKVmNMjLnf/E3F1UuhUDeagXwZO0zKdfirGtBEEYXqFNOVlH53b1N4WCxW/O5UeEdpUS5ZOAHDlLgoroTBQSAowQvP0KHk6dwnzd6IGAEXghFzEy+OSiStAlew//U5/qPgMP/k8iR6IO3C0qlnxzej6SdSZJTKnpcTr0O2snBK3XAoAFWyJUOo1AKvadz/a6/56neoeELiwXun7TK0wYtX22u7sQqJbQoU2j0nVOc0mx5zS0XhshI2+gAAAA=',
  tall: 'data:image/webp;base64,UklGRnwBAABXRUJQVlA4IHABAADwCgCdASokAEAAPulap02pJKOiMBqtUSAdCWwAtSHA/gHPKbtlZGU/+6sMlFzaOvl5Vi6fJZQe7v33E666iSi7r2NLLtSzuXyBn9H/qtvvOttl19qQVNRPmdz/ZygQFQAA8GuCmt5F9PvZ6YcdJNlt7bQHmKlW85gzWQAPloaAp6YP9du8oM6TW3J6+d5o/GszTkDjD+t6jhOxkbZg/sVUa1erxUzegOEGab5OcI0Neq8VP35kk4lQBMkntFOZ+Cq50m2Xg88AyCxT4B2WJn9Vh8vuC768oRUUXYGtf8nwhAmyOxr+wyL1cZWC+PDeEGixP5BQWypWQRb5iYsPjDJf0w5/ihBWHxVQZjVCh8NqXIkO5vB1Luy02jRm8eMx946hTGYvykgVoIA9KwDuMgePOew5Vq2PYhy+lYO+gJ0ych5MO0UVhnrBE4EFiGCibkCwd5sGQzLR0Q8X0oHoN1OYgA/9SwFwS8fG1/26w0AAAA==',
} as const;
