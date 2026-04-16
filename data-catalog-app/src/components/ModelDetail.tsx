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
        <Text className="font-mono font-bold text-2xl">{model.name}</Text>
        {model.description && (
          <Text className="text-kumo-subtle">{model.description}</Text>
        )}
      </div>

      {/* Metadata cards */}
      <div className="grid grid-cols-4 gap-4">
        <Surface className="rounded-lg p-4">
          <Text className="text-kumo-subtle text-xs uppercase tracking-wide mb-1">
            Layer
          </Text>
          <Text className="font-medium">{model.layer}</Text>
        </Surface>
        <Surface className="rounded-lg p-4">
          <Text className="text-kumo-subtle text-xs uppercase tracking-wide mb-1">
            Schema
          </Text>
          <Text className="font-mono font-medium">
            {model.database}.{model.schema}
          </Text>
        </Surface>
        <Surface className="rounded-lg p-4">
          <Text className="text-kumo-subtle text-xs uppercase tracking-wide mb-1">
            Materialization
          </Text>
          <Text className="font-medium">{model.materialization}</Text>
        </Surface>
        <Surface className="rounded-lg p-4">
          <Text className="text-kumo-subtle text-xs uppercase tracking-wide mb-1">
            Columns
          </Text>
          <Text className="font-medium">{model.columns.length}</Text>
        </Surface>
      </div>

      {/* Tags */}
      {model.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Text className="text-kumo-subtle text-sm font-medium">Tags:</Text>
          {model.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Lineage */}
      <div className="flex flex-col gap-3">
        <Text className="font-semibold">Lineage</Text>
        <LineageBadges label="Depends on" nodeIds={model.dependsOn} />
        <LineageBadges label="Referenced by" nodeIds={model.referencedBy} />
        {model.dependsOn.length === 0 && model.referencedBy.length === 0 && (
          <Text className="text-kumo-subtle text-sm">No lineage information available.</Text>
        )}
      </div>

      {/* Columns */}
      <div className="flex flex-col gap-3">
        <Text className="font-semibold">
          Columns ({model.columns.length})
        </Text>
        <ColumnTable columns={model.columns} />
      </div>

      {/* Source path */}
      <div>
        <Text className="text-kumo-subtle text-xs font-mono">{model.path}</Text>
      </div>
    </div>
  );
}
