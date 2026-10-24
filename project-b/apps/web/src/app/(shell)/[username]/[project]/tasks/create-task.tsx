"use client";

import type { MemberItem, MilestoneSummary, TaskPriority, TaskStatus, TaskSummary } from "@bldt/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { errorMessage, http } from "@/lib/api.client";
import { ModKey } from "@/components/ui/mod-key";
import { AssigneePicker, DueDateInput, MilestonePicker, PriorityPicker, StatusPicker } from "./pickers";
import { api, keys, type ProjectRef } from "./use-tasks";

export function CreateTaskDialog({
  project,
  members,
  milestones,
  defaultStatus,
  defaultMilestoneId,
  onClose,
}: {
  project: ProjectRef;
  members: MemberItem[];
  milestones: MilestoneSummary[];
  defaultStatus: TaskStatus;
  defaultMilestoneId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [priority, setPriority] = useState<TaskPriority>("NONE");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [milestoneId, setMilestoneId] = useState<string | null>(defaultMilestoneId);
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const assignee = members.find((m) => m.user.id === assigneeId)?.user ?? null;
  const milestone = milestones.find((m) => m.id === milestoneId) ?? null;

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const task = await http.post<TaskSummary>(`${api(project)}/tasks`, {
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        assigneeId,
        milestoneId,
        dueOn,
      });
      qc.setQueryData<TaskSummary[]>(keys.tasks(project), (old) => (old ? [...old, task] : [task]));
      qc.invalidateQueries({ queryKey: keys.milestones(project) });
      toast.success(`${task.identifier} created`, { description: task.title });
      if (more) {
        setTitle("");
        setDescription("");
        titleRef.current?.focus();
      } else {
        onClose();
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`New task in ${project.key}`} wide className="[&>div:last-child]:p-0">
        <div onKeyDown={onKeyDown}>
          <div className="px-5 pt-4">
            <input
              ref={titleRef}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Task title"
              aria-label="Task title"
              maxLength={200}
              className="w-full bg-transparent text-base font-medium outline-none placeholder:text-faint"
            />
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details, acceptance criteria, links. Markdown supported."
              aria-label="Description"
              rows={4}
              className="mt-2 border-0 bg-transparent px-0 hover:border-0 focus-visible:outline-0"
            />
          </div>
          <div className="flex flex-wrap items-center gap-0.5 border-t border-border px-3 py-2">
            <StatusPicker value={status} onChange={setStatus} />
            <PriorityPicker value={priority} onChange={setPriority} />
            <AssigneePicker value={assignee} members={members} onChange={setAssigneeId} />
            {milestones.length > 0 && <MilestonePicker value={milestone} milestones={milestones} onChange={setMilestoneId} />}
            <DueDateInput value={dueOn} onChange={setDueOn} />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border bg-bg-subtle px-5 py-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              <Switch checked={more} onChange={setMore} label="Create more" /> Create more
            </label>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={submit}>
                Create task <ModKey k="↵" className="ml-1 border-primary-fg/20 bg-transparent text-primary-fg/70" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
