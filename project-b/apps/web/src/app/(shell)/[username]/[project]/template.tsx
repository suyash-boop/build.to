/** Re-mounts on navigation, so each page fades in once its content is ready. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
