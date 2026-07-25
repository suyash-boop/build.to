"use client";

import Link from "next/link";
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
  async function handleSignOut() {
    // Redirect in onSuccess with a full navigation so the sign-out completes
    // even though clicking the item closes (and unmounts) this dropdown. A
    // router.push here can be aborted by that unmount; window.location cannot.
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/";
        },
      },
    });
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
