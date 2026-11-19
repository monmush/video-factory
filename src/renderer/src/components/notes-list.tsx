import { NOTE_AREA_LABEL, type Note } from "@shared/notes";
import { X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAction } from "@/lib/use-action";

export function NotesList({ notes }: { notes: Note[] }) {
  const { error, run } = useAction();
  return (
    <div>
      <ul className="flex flex-col">
        {notes.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            onSave={(text) => run(() => api.invoke("notes:update", { id: note.id, text }))}
            onRemove={() => run(() => api.invoke("notes:remove", note.id))}
          />
        ))}
      </ul>
      {error && <p className="mt-2 px-3 text-xs text-destructive-foreground">{error}</p>}
    </div>
  );
}

function NoteRow({
  note,
  onSave,
  onRemove,
}: {
  note: Note;
  onSave: (text: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const alreadyClosed = useRef(false);
  const open = () => {
    alreadyClosed.current = false;
    setDraft(note.text);
  };
  const close = (save: boolean) => {
    if (alreadyClosed.current) return;
    alreadyClosed.current = true;
    if (save && draft?.trim() && draft.trim() !== note.text) onSave(draft);
    setDraft(null);
  };
  return (
    <li className="group flex min-h-9 items-center gap-3 rounded-lg px-3 hover:bg-accent/50">
      {draft === null ? (
        <button
          type="button"
          className="min-w-0 flex-1 cursor-text py-1.5 text-left"
          onClick={open}
        >
          {note.text}
        </button>
      ) : (
        <Input
          className="flex-1"
          size="sm"
          autoFocus
          value={draft}
          aria-label="Sửa ghi nhớ"
          onValueChange={setDraft}
          onBlur={() => close(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") close(true);
            if (e.key === "Escape") close(false);
          }}
        />
      )}
      <span className="shrink-0 text-xs text-muted-foreground">{NOTE_AREA_LABEL[note.area]}</span>
      <Button
        variant="ghost-muted"
        size="icon-xs"
        className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Bỏ ghi nhớ"
        onClick={onRemove}
      >
        <X />
      </Button>
    </li>
  );
}
