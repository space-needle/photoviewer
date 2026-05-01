import { useState } from "react";

import { updateVisitTitle, type Visit } from "../../lib/api";

type EditableVisitTitleProps = {
  visit: Visit;
  onRenamed: (visit: Visit) => void;
  className?: string;
  fallbackTitle?: string;
};

export function EditableVisitTitle(props: EditableVisitTitleProps) {
  const { visit, onRenamed, className, fallbackTitle = "Selected visit" } = props;
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(visit.title ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveTitle() {
    const nextTitle = draftTitle.trim();

    if (!nextTitle) {
      setError("Title is required.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updatedVisit = await updateVisitTitle({
        visitId: visit.id,
        title: nextTitle,
      });
      onRenamed(updatedVisit);
      setDraftTitle(updatedVisit.title ?? "");
      setIsEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to rename visit.");
    } finally {
      setIsSaving(false);
    }
  }

  function cancelEdit() {
    setDraftTitle(visit.title ?? "");
    setError(null);
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <form
        className={className ? `editableVisitTitle ${className}` : "editableVisitTitle"}
        onSubmit={(event) => {
          event.preventDefault();
          void saveTitle();
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          maxLength={120}
          value={draftTitle}
          disabled={isSaving}
          onBlur={cancelEdit}
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
            }
          }}
        />
        <button
          type="submit"
          disabled={isSaving}
          onMouseDown={(event) => event.preventDefault()}
        >
          {isSaving ? "Saving" : "Save"}
        </button>
        {error ? <span className="editableVisitError">{error}</span> : null}
      </form>
    );
  }

  return (
    <span className={className ? `editableVisitTitle ${className}` : "editableVisitTitle"}>
      <strong>{visit.title ?? fallbackTitle}</strong>
      <button
        type="button"
        aria-label="Rename visit"
        className="visitTitleEditButton"
        onClick={(event) => {
          event.stopPropagation();
          setDraftTitle(visit.title ?? "");
          setError(null);
          setIsEditing(true);
        }}
      >
        Edit
      </button>
    </span>
  );
}
