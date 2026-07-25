"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadReposForShowcase,
  saveShowcase,
} from "./github-actions";
import { RepoCard } from "@/components/RepoCard";
import { Button, Card } from "@/components/ui";
import type { GithubRepo } from "@/lib/github";

const MAX = 6;

export interface GithubShowcaseProps {
  hasGithubUsername: boolean;
  initialSelectedIds: number[];
}

export function GithubShowcase({
  hasGithubUsername,
  initialSelectedIds,
}: GithubShowcaseProps) {
  const router = useRouter();
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(
    new Set(initialSelectedIds),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleLoad() {
    setLoading(true);
    setError(null);
    const result = await loadReposForShowcase();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRepos(result.repos);
  }

  function toggle(id: number) {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX) next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await saveShowcase([...selected]);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <Card className="p-6">
      <h2 className="text-l font-bold">GitHub projects</h2>
      <p className="mt-1 text-s text-secondary">
        Showcase up to {MAX} of your public repositories on your profile.
      </p>

      {!hasGithubUsername ? (
        <p className="mt-4 text-s text-secondary">
          Add your GitHub username in the Social links section above, then save
          and come back.
        </p>
      ) : repos === null ? (
        <div className="mt-4">
          <Button type="button" size="s" onClick={handleLoad} disabled={loading}>
            {loading ? "Loading…" : "Load my repositories"}
          </Button>
        </div>
      ) : (
        <>
          <p className="mt-4 text-s text-secondary">
            {selected.size} of {MAX} selected
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {repos.map((repo) => (
              <RepoCard
                key={repo.id}
                repo={repo}
                selectable
                selected={selected.has(repo.id)}
                onToggle={() => toggle(repo.id)}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button type="button" size="s" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save showcase"}
            </Button>
            {saved && <span className="text-s text-success">Saved.</span>}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 text-s text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
