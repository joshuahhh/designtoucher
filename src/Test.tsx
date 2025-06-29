import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React from "react";

/* ----------  Single sortable item  ---------- */

function Row({ id }: { id: string }) {
  const { setNodeRef, transform, transition, listeners, attributes } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: "flex",
    alignItems: "center",
    padding: "8px 12px",
    marginBottom: 4,
    border: "1px solid #ccc",
    background: "#fff",
  };

  return (
    <li ref={setNodeRef} style={style}>
      <div className="flex">
        {id}
        <div className="flex-grow" />
        <span
          {...listeners}
          {...attributes}
          style={{ cursor: "grab", marginRight: 8 }}
        >
          ☰
        </span>
      </div>
    </li>
  );
}

/* ----------  Main component  ---------- */

export function Test() {
  const [items, setItems] = React.useState(["A", "B", "C"]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = ({ active, over }: any) => {
    if (over && active.id !== over.id) {
      setItems((prev) =>
        arrayMove(prev, prev.indexOf(active.id), prev.indexOf(over.id)),
      );
    }
  };

  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToVerticalAxis]} // ↕ only
      onDragEnd={handleDragEnd}
    >
      <Row id="wow" />
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul style={{ padding: 0, listStyle: "none", width: 200 }}>
          {items.map((id) => (
            <Row key={id} id={id} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
