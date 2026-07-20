"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Avatar, Dropdown, DropdownItem } from "@/components/ui";

const menuLink =
  "flex w-full items-center gap-2 rounded px-3 py-2 text-left text-base text-body transition-colors hover:bg-base-bg";

export interface UserMenuProps {
  name: string;
  username: string | null;
  image: string | null;
}

export function UserMenu({ name, username, image }: UserMenuProps) {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <Dropdown trigger={<Avatar name={name} src={image} size="m" />}>
      <div className="px-3 py-2">
        <p className="truncate text-base font-medium text-body">{name}</p>
        {username && (
          <p className="truncate text-s text-secondary">@{username}</p>
        )}
      </div>
      <div className="my-1 border-t border-border" />
      <Link href="/drafts" className={menuLink}>
        Drafts
      </Link>
      <div className="my-1 border-t border-border" />
      <DropdownItem onClick={handleSignOut}>Sign out</DropdownItem>
    </Dropdown>
  );
}
