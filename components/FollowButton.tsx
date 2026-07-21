"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toggleFollow } from "@/app/actions/follows";
import { Button } from "@/components/ui";
import type { FollowableType } from "@prisma/client";

export interface FollowButtonProps {
  followableId: string;
  followableType: FollowableType;
  initialFollowing: boolean;
  signedIn: boolean;
  size?: "s" | "m" | "l";
}

export function FollowButton({
  followableId,
  followableType,
  initialFollowing,
  signedIn,
  size = "s",
}: FollowButtonProps) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!signedIn) {
      router.push("/login");
      return;
    }

    // Optimistic, rolled back if the server disagrees.
    const previous = following;
    setFollowing(!previous);
    setPending(true);

    const result = await toggleFollow(followableId, followableType);
    setPending(false);

    if (!result.ok) {
      setFollowing(previous);
      return;
    }
    setFollowing(result.following);
    router.refresh();
  }

  return (
    <Button
      variant={following ? "outline" : "primary"}
      size={size}
      onClick={handleClick}
      disabled={pending}
      aria-pressed={following}
    >
      {following ? "Following" : "Follow"}
    </Button>
  );
}
