import { Badge, Surface, Text } from "@cloudflare/kumo";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import type { CatalogModel } from "../lib/types";
import { ColumnTable } from "./ColumnTable";
import { LineageBadges } from "./LineageBadges";

interface ModelDetailProps {
  model: CatalogModel;
}

export function ModelDetail({ model }: ModelDetailProps) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <a
          href="/models"
          className="flex items-center gap-1 text-kumo-subtle text-sm hover:text-kumo-default w-fit"
        >
          <ArrowLeftIcon size={16} />
          Back to Models
        </a>
        <span className="font-mono font-bold text-2xl">{model.name}</span>
        {model.description && (
          <Text variant="secondary">{model.description}</Text>
        )}
      </div>

      {/* Metadata cards */}
      <div className="grid grid-cols-4 gap-4">
        <Surface className="rounded-lg p-4">
          <span className="text-kumo-subtle text-xs uppercase tracking-wide mb-1 block">
            Layer
          </span>
          <Text bold>{model.layer}</Text>
        </Surface>
        <Surface className="rounded-lg p-4">
          <span className="text-kumo-subtle text-xs uppercase tracking-wide mb-1 block">
            Schema
          </span>
          <span className="font-mono font-medium">
            {model.database}.{model.schema}
          </span>
        </Surface>
        <Surface className="rounded-lg p-4">
          <span className="text-kumo-subtle text-xs uppercase tracking-wide mb-1 block">
            Materialization
          </span>
          <Text bold>{model.materialization}</Text>
        </Surface>
        <Surface className="rounded-lg p-4">
          <span className="text-kumo-subtle text-xs uppercase tracking-wide mb-1 block">
            Columns
          </span>
          <Text bold>{model.columns.length}</Text>
        </Surface>
      </div>

      {/* Tags */}
      {model.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-kumo-subtle text-sm font-medium">Tags:</span>
          {model.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Lineage */}
      <div className="flex flex-col gap-3">
        <span className="font-semibold">Lineage</span>
        <LineageBadges label="Depends on" nodeIds={model.dependsOn} />
        <LineageBadges label="Referenced by" nodeIds={model.referencedBy} />
        {model.dependsOn.length === 0 && model.referencedBy.length === 0 && (
          <Text variant="secondary" size="sm">No lineage information available.</Text>
        )}
      </div>

      {/* Columns */}
      <div className="flex flex-col gap-3">
        <span className="font-semibold">
          Columns ({model.columns.length})
        </span>
        <ColumnTable columns={model.columns} />
      </div>

      {/* Source path */}
      <div>
        <span className="text-kumo-subtle text-xs font-mono">{model.path}</span>
      </div>
    </div>
  );
}
