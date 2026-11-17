"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/api/convex/_generated/api";

/** One project owns many QA threads. Selecting one keeps the chat in that thread. */
export default function ThreadBar({ projectId, currentId }: { projectId: string; currentId?: string | null }) {
  const router = useRouter();
  const threads = useQuery(api.threads.list, { projectId: projectId as never });
  const createThread = useMutation(api.conversations.createThread);

  const rows = (threads ?? []).filter((thread) => thread.kind === "conversation");

  const openNew = async () => {
    const id = await createThread({ projectId: projectId as never });
    router.push(`/project/${projectId}/${id}`);
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-panel px-3 py-1.5">
      <span className="shrink-0 text-caption">Threads</span>
      {rows.map((thread, index) => (
        <button
          key={thread.id}
          type="button"
          onClick={() => router.push(`/project/${projectId}/${thread.conversationId ?? thread.id}`)}
          className={`shrink-0 rounded-field px-2 py-1 text-[12.5px] outline-none transition focus-visible:ring-2 focus-visible:ring-ink/30 ${
            thread.conversationId === currentId ? "bg-hover font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
          }`}
        >
          {thread.title?.trim() || `Thread ${index + 1}`}
        </button>
      ))}
      <button
        type="button"
        onClick={() => void openNew()}
        className="shrink-0 rounded-field px-2 py-1 text-[12.5px] text-ink-2 outline-none transition hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30"
      >
        + New thread
      </button>
    </div>
  );
}
