import Link from "next/link";
import { Card } from "@/components/ui";

interface TagItem {
  name: string;
  bgColorHex: string;
  postsCount: number;
}

/** Feed right rail — the most-used tags, each linking to its tag page. */
export function PopularTags({ tags }: { tags: TagItem[] }) {
  if (tags.length === 0) return null;

  return (
    <Card className="sticky top-20 p-4">
      <h2 className="mb-2 text-s font-bold uppercase tracking-wide text-secondary">
        Popular tags
      </h2>
      <ul className="flex flex-col">
        {tags.map((tag) => (
          <li key={tag.name}>
            <Link
              href={`/t/${tag.name}`}
              className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-base transition-colors hover:bg-base-bg"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: tag.bgColorHex }}
                />
                <span className="text-body">#{tag.name}</span>
              </span>
              <span className="text-s text-secondary">{tag.postsCount}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
