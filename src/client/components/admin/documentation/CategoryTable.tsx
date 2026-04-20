import { UnifiedTable } from '../../table';
import type { UnifiedColumnDef } from '../../table/types';
import type { DocCategory } from './types';

interface CategoryTableProps {
  categories: DocCategory[];
  onEdit: (category: DocCategory) => void;
  onDelete: (category: DocCategory) => void;
  onAdd: () => void;
}

/** Section A of the documentation tab: list + add/edit/remove of doc categories. */
export function CategoryTable({
  categories,
  onEdit,
  onDelete,
  onAdd,
}: CategoryTableProps) {
  const categoryColumns: UnifiedColumnDef<DocCategory>[] = [
    {
      kind: 'data',
      id: 'ordinal',
      header: { full: 'Ordinal' },
      renderCell: (cat) => cat.ordinal,
    },
    {
      kind: 'data',
      id: 'name',
      header: { full: 'Name' },
      renderCell: (cat) => cat.name,
    },
    {
      kind: 'data',
      id: 'weight',
      header: { full: 'Weight' },
      renderCell: (cat) => cat.weight,
    },
    {
      kind: 'data',
      id: 'max_score',
      header: { full: 'Max Score' },
      renderCell: (cat) => cat.max_score,
    },
    {
      kind: 'data',
      id: 'actions',
      header: { full: 'Actions' },
      renderCell: (cat) => (
        <>
          <button className="btn btn-secondary" onClick={() => onEdit(cat)}>
            Edit
          </button>
          <button
            className="btn btn-danger"
            onClick={() => onDelete(cat)}
            style={{ marginLeft: '0.5rem' }}
          >
            Remove
          </button>
        </>
      ),
    },
  ];

  return (
    <div className="card documentation-section">
      <h3>Documentation Categories</h3>
      <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
        Define scoring categories for this event. Existing overall_score values
        are computed at save-time; re-saving a team score will recompute under
        new weights/max.
      </p>
      <button
        className="btn btn-primary"
        onClick={onAdd}
        disabled={categories.length >= 4}
      >
        + Add Category
      </button>
      {categories.length >= 4 && (
        <small
          style={{ marginLeft: '0.5rem', color: 'var(--secondary-color)' }}
        >
          (Max 4 categories)
        </small>
      )}
      <div style={{ marginTop: '1rem' }}>
        {categories.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            No categories yet. Add categories to start scoring.
          </p>
        ) : (
          <UnifiedTable
            columns={categoryColumns}
            rows={categories}
            getRowKey={(cat) => cat.id}
            headerLabelVariant="none"
          />
        )}
      </div>
    </div>
  );
}
