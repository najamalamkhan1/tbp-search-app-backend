import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  ChoiceList,
  EmptyState,
  FormLayout,
  InlineGrid,
  InlineStack,
  Modal,
  Page,
  Select,
  Spinner,
  Text,
  TextField,
  Toast
} from "@shopify/polaris";
import { DeleteIcon, DragHandleIcon, EditIcon } from "@shopify/polaris-icons";
import {
  FILTER_TYPES,
  STATUS_OPTIONS,
  VISIBILITY_OPTIONS,
  bulkDeleteFilters,
  bulkUpdateFilterStatus,
  createFilter,
  deleteFilter,
  getFilters,
  reorderFilters,
  updateFilter,
  updateFilterStatus,
  updateFilterVisibility
} from "../utils/filterApi";

const emptyForm = {
  label: "",
  filterType: "availability",
  source: "",
  visibility: "visible",
  status: "active",
  position: 0,
  settings: {
    enabled: true,
    searchable: false,
    multiSelect: true,
    pinned: false,
    group: "",
    colorSwatches: {}
  },
  metafield: {
    namespace: "",
    key: ""
  }
};

export async function loader({ request }) {
  const url = new URL(request.url);
  return json({
    shop: url.searchParams.get("shop") || "",
    apiBaseUrl: process.env.API_BASE_URL || process.env.BACKEND_URL || ""
  });
}

const humanize = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const cloneForm = (filter = emptyForm) => ({
  ...emptyForm,
  ...filter,
  settings: {
    ...emptyForm.settings,
    ...(filter.settings || {}),
    colorSwatches: Object.fromEntries(
      filter.settings?.colorSwatches instanceof Map
        ? filter.settings.colorSwatches
        : Object.entries(filter.settings?.colorSwatches || {})
    )
  },
  metafield: {
    ...emptyForm.metafield,
    ...(filter.metafield || {})
  }
});

function FilterForm({ form, setForm }) {
  const isMetafield = ["metafield_boolean", "metafield_text", "metafield_list"].includes(form.filterType);
  const isColorSwatch = form.filterType === "color_swatch";
  const swatchText = Object.entries(form.settings.colorSwatches || {})
    .map(([name, color]) => `${name}:${color}`)
    .join("\n");

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const updateSetting = (field, value) =>
    setForm((current) => ({
      ...current,
      settings: { ...current.settings, [field]: value }
    }));
  const updateMetafield = (field, value) =>
    setForm((current) => ({
      ...current,
      metafield: { ...current.metafield, [field]: value }
    }));

  const updateSwatches = (value) => {
    const colorSwatches = {};
    value.split("\n").forEach((line) => {
      const [name, color] = line.split(":").map((part) => String(part || "").trim());
      if (name && color) colorSwatches[name] = color;
    });
    updateSetting("colorSwatches", colorSwatches);
  };

  return (
    <FormLayout>
      <TextField label="Label" value={form.label} onChange={(value) => update("label", value)} autoComplete="off" />
      <Select label="Filter type" options={FILTER_TYPES} value={form.filterType} onChange={(value) => update("filterType", value)} />
      <TextField label="Source" value={form.source} onChange={(value) => update("source", value)} autoComplete="off" />
      <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
        <Select label="Visibility" options={VISIBILITY_OPTIONS} value={form.visibility} onChange={(value) => update("visibility", value)} />
        <Select label="Status" options={STATUS_OPTIONS} value={form.status} onChange={(value) => update("status", value)} />
      </InlineGrid>

      <ChoiceList
        title="Settings"
        allowMultiple
        choices={[
          { label: "Enabled", value: "enabled" },
          { label: "Searchable values", value: "searchable" },
          { label: "Allow multiple selections", value: "multiSelect" },
          { label: "Pinned filter", value: "pinned" }
        ]}
        selected={Object.entries(form.settings)
          .filter(([, value]) => value === true)
          .map(([key]) => key)}
        onChange={(selected) => {
          ["enabled", "searchable", "multiSelect", "pinned"].forEach((key) => updateSetting(key, selected.includes(key)));
        }}
      />

      <TextField label="Filter group" value={form.settings.group || ""} onChange={(value) => updateSetting("group", value)} autoComplete="off" />

      {isMetafield ? (
        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
          <TextField label="Metafield namespace" value={form.metafield.namespace} onChange={(value) => updateMetafield("namespace", value)} autoComplete="off" />
          <TextField label="Metafield key" value={form.metafield.key} onChange={(value) => updateMetafield("key", value)} autoComplete="off" />
        </InlineGrid>
      ) : null}

      {isColorSwatch ? (
        <TextField
          label="Color swatches"
          helpText="One color per line. Example: olive:#808000"
          value={swatchText}
          onChange={updateSwatches}
          multiline={4}
          autoComplete="off"
        />
      ) : null}
    </FormLayout>
  );
}

function FilterRow({ filter, selected, onSelect, onEdit, onDelete, onStatus, onVisibility, onDragStart, onDrop }) {
  return (
    <div
      draggable
      onDragStart={(event) => onDragStart(event, filter._id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, filter._id)}
      style={{
        borderBottom: "1px solid #ebebeb",
        padding: "12px 16px",
        background: "white"
      }}
    >
      <InlineGrid columns="32px 40px 1.6fr 1fr 1fr 1fr 1.2fr" gap="300" alignItems="center">
        <Checkbox label="" checked={selected} onChange={(checked) => onSelect(filter._id, checked)} />
        <Button icon={DragHandleIcon} accessibilityLabel="Drag filter" variant="tertiary" />
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" fontWeight="semibold">{filter.label}</Text>
            {filter.settings?.pinned ? <Badge tone="info">Pinned</Badge> : null}
          </InlineStack>
          <Text as="span" tone="subdued" variant="bodySm">{filter.source || "Default product source"}</Text>
        </BlockStack>
        <Text as="span">{humanize(filter.filterType)}</Text>
        <Badge tone={filter.status === "active" ? "success" : "critical"}>{humanize(filter.status)}</Badge>
        <Badge tone={filter.visibility === "visible" ? "success" : "attention"}>{humanize(filter.visibility)}</Badge>
        <InlineStack gap="200" align="end">
          <Button size="slim" onClick={() => onStatus(filter)}>
            {filter.status === "active" ? "Disable" : "Enable"}
          </Button>
          <Button size="slim" onClick={() => onVisibility(filter)}>
            {filter.visibility === "visible" ? "Hide" : "Show"}
          </Button>
          <Button size="slim" icon={EditIcon} accessibilityLabel="Edit filter" onClick={() => onEdit(filter)} />
          <Button size="slim" tone="critical" icon={DeleteIcon} accessibilityLabel="Delete filter" onClick={() => onDelete(filter)} />
        </InlineStack>
      </InlineGrid>
    </div>
  );
}

export default function FiltersPage() {
  const loaderData = useLoaderData();
  const [searchParams] = useSearchParams();
  const shop = loaderData.shop || searchParams.get("shop") || "";
  const apiBaseUrl = loaderData.apiBaseUrl || "";

  const [filters, setFilters] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingFilter, setEditingFilter] = useState(null);
  const [form, setForm] = useState(cloneForm());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [draggedId, setDraggedId] = useState(null);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filters;
    return filters.filter((filter) =>
      [filter.label, filter.filterType, filter.source, filter.settings?.group]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [filters, query]);

  const loadFilters = useCallback(async () => {
    if (!shop) {
      setError("Missing shop parameter.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await getFilters({ apiBaseUrl, shop });
      setFilters(data.filters || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, shop]);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  const openCreate = () => {
    setEditingFilter(null);
    setForm(cloneForm({ position: filters.length }));
    setModalOpen(true);
  };

  const openEdit = (filter) => {
    setEditingFilter(filter);
    setForm(cloneForm(filter));
    setModalOpen(true);
  };

  const saveFilter = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, shop };
      const data = editingFilter
        ? await updateFilter({ apiBaseUrl, id: editingFilter._id, payload })
        : await createFilter({ apiBaseUrl, payload });

      setFilters((current) => {
        if (editingFilter) return current.map((filter) => (filter._id === data.filter._id ? data.filter : filter));
        return [...current, data.filter].sort((a, b) => a.position - b.position);
      });
      setToast(editingFilter ? "Filter updated" : "Filter created");
      setModalOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteFilter({ apiBaseUrl, id: deleteTarget._id });
      setFilters((current) => current.filter((filter) => filter._id !== deleteTarget._id));
      setSelectedIds((current) => current.filter((id) => id !== deleteTarget._id));
      setToast("Filter deleted");
      setDeleteTarget(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (filter) => {
    const status = filter.status === "active" ? "inactive" : "active";
    try {
      const data = await updateFilterStatus({ apiBaseUrl, id: filter._id, status });
      setFilters((current) => current.map((item) => (item._id === filter._id ? data.filter : item)));
      setToast("Status updated");
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleVisibility = async (filter) => {
    const visibility = filter.visibility === "visible" ? "hidden" : "visible";
    try {
      const data = await updateFilterVisibility({ apiBaseUrl, id: filter._id, visibility });
      setFilters((current) => current.map((item) => (item._id === filter._id ? data.filter : item)));
      setToast("Visibility updated");
    } catch (err) {
      setError(err.message);
    }
  };

  const selectFilter = (id, checked) => {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  };

  const selectAll = (checked) => {
    setSelectedIds(checked ? filteredRows.map((filter) => filter._id) : []);
  };

  const bulkDelete = async () => {
    if (!selectedIds.length) return;
    setSaving(true);
    try {
      await bulkDeleteFilters({ apiBaseUrl, shop, ids: selectedIds });
      setFilters((current) => current.filter((filter) => !selectedIds.includes(filter._id)));
      setSelectedIds([]);
      setToast("Filters deleted");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const bulkStatus = async (status) => {
    if (!selectedIds.length) return;
    setSaving(true);
    try {
      await bulkUpdateFilterStatus({ apiBaseUrl, shop, ids: selectedIds, status });
      await loadFilters();
      setSelectedIds([]);
      setToast(status === "active" ? "Filters enabled" : "Filters disabled");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveOrder = async (nextFilters) => {
    const items = nextFilters.map((filter, index) => ({ id: filter._id, position: index }));
    try {
      const data = await reorderFilters({ apiBaseUrl, shop, items });
      setFilters(data.filters || nextFilters);
      setToast("Order updated");
    } catch (err) {
      setError(err.message);
      await loadFilters();
    }
  };

  const handleDrop = async (event, targetId) => {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    const from = filters.findIndex((filter) => filter._id === draggedId);
    const to = filters.findIndex((filter) => filter._id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...filters];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const positioned = next.map((filter, index) => ({ ...filter, position: index }));
    setFilters(positioned);
    setDraggedId(null);
    await saveOrder(positioned);
  };

  const allSelected = filteredRows.length > 0 && filteredRows.every((filter) => selectedIds.includes(filter._id));

  return (
    <Page
      title="Search filters"
      subtitle="Create and manage storefront search filters."
      primaryAction={{ content: "Add filter", onAction: openCreate }}
    >
      <BlockStack gap="400">
        {error ? <Banner tone="critical" onDismiss={() => setError("")}>{error}</Banner> : null}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Box minWidth="320px">
                <TextField label="Search filters" labelHidden value={query} onChange={setQuery} placeholder="Search filters" autoComplete="off" />
              </Box>
              <InlineStack gap="200">
                <ButtonGroup>
                  <Button disabled={!selectedIds.length || saving} onClick={() => bulkStatus("active")}>Bulk enable</Button>
                  <Button disabled={!selectedIds.length || saving} onClick={() => bulkStatus("inactive")}>Bulk disable</Button>
                  <Button tone="critical" disabled={!selectedIds.length || saving} onClick={bulkDelete}>Bulk delete</Button>
                </ButtonGroup>
              </InlineStack>
            </InlineStack>

            {loading ? (
              <Box padding="800">
                <InlineStack align="center">
                  <Spinner accessibilityLabel="Loading filters" size="large" />
                </InlineStack>
              </Box>
            ) : filters.length === 0 ? (
              <EmptyState
                heading="No search filters yet"
                action={{ content: "Add filter", onAction: openCreate }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Create filters for availability, price, product type, vendors, colors, sizes, tags, collections, and metafields.</p>
              </EmptyState>
            ) : (
              <BlockStack gap="0">
                <Box padding="400" background="bg-surface-secondary">
                  <InlineGrid columns="32px 40px 1.6fr 1fr 1fr 1fr 1.2fr" gap="300" alignItems="center">
                    <Checkbox label="" checked={allSelected} onChange={selectAll} />
                    <Text as="span" tone="subdued">Sort</Text>
                    <Text as="span" fontWeight="semibold">Filter</Text>
                    <Text as="span" fontWeight="semibold">Type</Text>
                    <Text as="span" fontWeight="semibold">Status</Text>
                    <Text as="span" fontWeight="semibold">Visibility</Text>
                    <Text as="span" alignment="end" fontWeight="semibold">Actions</Text>
                  </InlineGrid>
                </Box>
                {filteredRows.map((filter) => (
                  <FilterRow
                    key={filter._id}
                    filter={filter}
                    selected={selectedIds.includes(filter._id)}
                    onSelect={selectFilter}
                    onEdit={openEdit}
                    onDelete={setDeleteTarget}
                    onStatus={toggleStatus}
                    onVisibility={toggleVisibility}
                    onDragStart={(_, id) => setDraggedId(id)}
                    onDrop={handleDrop}
                  />
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal
        open={modalOpen}
        title={editingFilter ? "Edit filter" : "Add filter"}
        onClose={() => setModalOpen(false)}
        primaryAction={{ content: "Save", loading: saving, onAction: saveFilter }}
        secondaryActions={[{ content: "Cancel", onAction: () => setModalOpen(false) }]}
      >
        <Modal.Section>
          <FilterForm form={form} setForm={setForm} />
        </Modal.Section>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        title="Delete filter"
        onClose={() => setDeleteTarget(null)}
        primaryAction={{ content: "Delete", destructive: true, loading: saving, onAction: confirmDelete }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteTarget(null) }]}
      >
        <Modal.Section>
          <Text as="p">Delete "{deleteTarget?.label}"? This cannot be undone.</Text>
        </Modal.Section>
      </Modal>

      {toast ? <Toast content={toast} onDismiss={() => setToast("")} /> : null}
    </Page>
  );
}
