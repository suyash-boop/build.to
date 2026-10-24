import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Untrusted markdown (READMEs, task descriptions, release notes). Raw HTML is not rendered,
 * and the sanitize pass strips anything outside GitHub's safe subset.
 */
export function Markdown({ children, className, baseUrl }: { children: string; className?: string; baseUrl?: string }) {
  return (
    <div className={cn("prose-bldt", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, defaultSchema]]}
        urlTransform={(url) => resolveUrl(url, baseUrl)}
        components={{
          a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" />,
          // eslint-disable-next-line @next/next/no-img-element
          img: ({ node: _n, ...props }) => <img {...props} alt={props.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Make README-relative links and images point at the repository instead of bld.t. */
function resolveUrl(url: string, baseUrl?: string): string {
  if (/^(https?:|mailto:|#)/i.test(url)) return url;
  if (/^(javascript|data|vbscript):/i.test(url.trim())) return "";
  if (!baseUrl) return url;
  try {
    return new URL(url.replace(/^\.\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return url;
  }
}
