"use client";

import type { MemberItem, MilestoneSummary, TaskDetail, TaskSummary, UpdateTaskInput } from "@bldt/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, http } from "@/lib/api.client";

export interface ProjectRef {
  owner: string;
  slug: string;
  key: string;
}

export const api = (p: ProjectRef) => `/projects/${p.owner}/${p.slug}`;
export const keys = {
  tasks: (p: ProjectRef) => ["tasks", p.owner, p.slug] as const,
  task: (p: ProjectRef, n: number) => ["task", p.owner, p.slug, n] as const,
  members: (p: ProjectRef) => ["members", p.owner, p.slug] as const,
  milestones: (p: ProjectRef) => ["milestones", p.owner, p.slug] as const,
};

export function useTasks(p: ProjectRef, initial: TaskSummary[]) {
  return useQuery({
    queryKey: keys.tasks(p),
    queryFn: () => http.get<{ items: TaskSummary[] }>(`${api(p)}/tasks`).then((r) => r.items),
    initialData: initial,
    refetchInterval: 30_000,
  });
}

export function useMembers(p: ProjectRef, initial?: MemberItem[]) {
  return useQuery({
    queryKey: keys.members(p),
    queryFn: () => http.get<{ items: MemberItem[] }>(`${api(p)}/members`).then((r) => r.items),
    initialData: initial,
    staleTime: 60_000,
  });
}

export function useMilestones(p: ProjectRef, initial?: MilestoneSummary[]) {
  return useQuery({
    queryKey: keys.milestones(p),
    queryFn: () => http.get<{ items: MilestoneSummary[] }>(`${api(p)}/milestones`).then((r) => r.items),
    initialData: initial,
    staleTime: 60_000,
  });
}

export function useTaskDetail(p: ProjectRef, number: number | null) {
  return useQuery({
    queryKey: keys.task(p, number ?? 0),
    queryFn: () => http.get<TaskDetail>(`${api(p)}/tasks/${number}`),
    enabled: number != null,
  });
}

/**
 * Optimistic task update: the board reflects the change immediately, the server is the
 * source of truth, and a failure rolls back with a toast.
 */
export function useUpdateTask(p: ProjectRef, ctx: { members?: MemberItem[]; milestones?: MilestoneSummary[] }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ number, patch }: { number: number; patch: UpdateTaskInput; optimisticPosition?: number }) =>
      http.patch<TaskSummary>(`${api(p)}/tasks/${number}`, patch),
    onMutate: async ({ number, patch, optimisticPosition }) => {
      await qc.cancelQueries({ queryKey: keys.tasks(p) });
      const prev = qc.getQueryData<TaskSummary[]>(keys.tasks(p));
      qc.setQueryData<TaskSummary[]>(keys.tasks(p), (old) =>
        old?.map((t) => {
          if (t.number !== number) return t;
          const next: TaskSummary = { ...t };
          if (patch.title !== undefined) next.title = patch.title;
          if (patch.status !== undefined) {
            next.status = patch.status;
            next.completedAt = patch.status === "DONE" || patch.status === "CANCELED" ? new Date().toISOString() : null;
          }
          if (patch.priority !== undefined) next.priority = patch.priority;
          if (patch.dueOn !== undefined) next.dueOn = patch.dueOn;
          if (patch.assigneeId !== undefined) {
            next.assignee = patch.assigneeId ? (ctx.members?.find((m) => m.user.id === patch.assigneeId)?.user ?? null) : null;
          }
          if (patch.milestoneId !== undefined) {
            const ms = ctx.milestones?.find((m) => m.id === patch.milestoneId);
            next.milestone = ms ? { id: ms.id, title: ms.title } : null;
          }
          if (optimisticPosition !== undefined) next.position = optimisticPosition;
          return next;
        }),
      );
      return { prev };
    },
    onError: (err, _v, context) => {
      if (context?.prev) qc.setQueryData(keys.tasks(p), context.prev);
      toast.error(errorMessage(err));
    },
    onSuccess: (task) => {
      qc.setQueryData<TaskSummary[]>(keys.tasks(p), (old) => old?.map((t) => (t.id === task.id ? { ...t, ...task, commentCount: t.commentCount } : t)));
      qc.invalidateQueries({ queryKey: keys.task(p, task.number) });
      qc.invalidateQueries({ queryKey: keys.milestones(p) });
    },
  });
}
