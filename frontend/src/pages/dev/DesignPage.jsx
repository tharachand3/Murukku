import { useState } from 'react';
import { BarChart3, Package, Search, ShoppingCart } from 'lucide-react';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Breadcrumbs } from '../../components/ui/Breadcrumbs.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card, CardBody, CardFooter, CardHeader } from '../../components/ui/Card.jsx';
import { Drawer } from '../../components/ui/Drawer.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { IconButton } from '../../components/ui/IconButton.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { Popover } from '../../components/ui/Popover.jsx';
import { ProgressBar } from '../../components/ui/ProgressBar.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { Skeleton } from '../../components/ui/Skeleton.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { Stat } from '../../components/ui/Stat.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { Tabs } from '../../components/ui/Tabs.jsx';
import { Textarea } from '../../components/ui/Textarea.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const statuses = ['SUBMITTED', 'APPROVED', 'REJECTED', 'INVOICED', 'DISPATCHED', 'CANCELLED', 'POSTED', 'ISSUED', 'COMPLETED', 'PAID', 'PARTIAL', 'UNPAID', 'FLAGGED'];
const rows = [{ id: 'PUR/26/01', item: 'Rice flour', qty: '42 kg', value: 'Rs 1,890' }];
const columns = [{ key: 'id', label: 'Reference' }, { key: 'item', label: 'Item' }, { key: 'qty', label: 'Quantity', numeric: true }, { key: 'value', label: 'Value', numeric: true }];

export default function DesignPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [tab, setTab] = useState('overview');
  const toast = useToast();
  return <main className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
    <header><p className="text-sm font-semibold text-brand-700">Design system</p><h1>Order-to-Audit</h1><p className="text-slate-600">Warm, clear components for daily factory operations.</p></header>
    <section><h2 className="mb-3">Actions and status</h2><div className="flex flex-wrap items-center gap-3"><Button size="sm">Small</Button><Button leftIcon={<ShoppingCart size={16} />}>Primary action</Button><Button size="lg" variant="accent">Highlighted action</Button><Button variant="secondary">Secondary</Button><Button variant="danger">Danger</Button><Button variant="ghost">Ghost</Button><Button variant="link">Link</Button><Button loading>Saving</Button><IconButton label="Search"><Search size={18} /></IconButton><Badge>Neutral</Badge><Badge tone="success">Success</Badge><Badge tone="warning">Needs attention</Badge><Badge tone="danger">Error</Badge></div><div className="mt-4 flex flex-wrap gap-2">{statuses.map((status) => <StatusBadge key={status} status={status} />)}</div></section>
    <section><h2 className="mb-3">Fields</h2><div className="grid gap-4 md:grid-cols-2"><Input label="Search item" leftIcon={<Search size={16} />} placeholder="Type an item name" /><Input label="Amount" prefix="Rs" suffix="INR" value="1,250" readOnly /><Input label="Email" error="Enter a valid email address" value="not-an-email" readOnly /><Select label="Stock group"><option>Raw materials</option><option>Packaging</option></Select><Textarea label="Notes" hint="Add context for the audit trail." placeholder="Optional notes" /></div></section>
    <section><h2 className="mb-3">Cards and statistics</h2><div className="grid gap-4 md:grid-cols-3"><Card className="!p-0"><CardHeader><h3 className="font-semibold">Stock snapshot</h3></CardHeader><CardBody><p className="text-sm text-slate-600">Finished goods available</p><p className="text-2xl font-semibold tabular-nums">238 packets</p></CardBody><CardFooter><span className="text-sm text-slate-500">Updated just now</span></CardFooter></Card><Stat icon={<Package />} label="Packets produced" value="1,240" sub="This month" tone="positive" trend="+8% from last month" /><Stat icon={<BarChart3 />} label="Open orders" value="12" tone="warning" sub="3 need attention" /></div></section>
    <section><h2 className="mb-3">Data and navigation</h2><Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Inventory', to: '/stock' }, { label: 'Purchases' }]} /><Tabs active={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview', count: 4 }, { key: 'history', label: 'History', count: 12 }]} /><div className="mt-4"><Table columns={columns} rows={rows} responsive zebra /><Pagination page={1} pages={3} onPage={() => {}} /></div></section>
    <section><h2 className="mb-3">Loading and empty states</h2><div className="grid gap-4 md:grid-cols-3"><Skeleton /><Skeleton variant="card" /><Skeleton variant="table" rows={2} /></div><div className="mt-4 flex items-center gap-4"><Spinner label="Loading preview" /><ProgressBar label="Production progress" value={72} /><Avatar name="Thara Kandra" /></div><div className="mt-4 grid gap-3 md:grid-cols-3">{['box', 'document', 'chart'].map((illustration) => <EmptyState illustration={illustration} key={illustration} title="Nothing to show" text="New records will appear here." />)}</div></section>
    <section><h2 className="mb-3">Overlays and notifications</h2><div className="flex flex-wrap gap-3"><Button onClick={() => setModalOpen(true)}>Open modal</Button><Button variant="secondary" onClick={() => setDrawerOpen(true)}>Open drawer</Button><Popover open={popoverOpen} onClose={() => setPopoverOpen(false)} trigger={<Button variant="secondary" onClick={() => setPopoverOpen((open) => !open)}>Popover</Button>}>Contextual help and quick actions</Popover><Button variant="secondary" onClick={() => toast.success('Purchase saved successfully.')}>Show toast</Button></div></section>
    <Modal footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={() => setModalOpen(false)}>Save</Button></div>} onClose={() => setModalOpen(false)} open={modalOpen} title="Review purchase"><p className="text-sm text-slate-600">Modal content stays scrollable while actions remain available.</p></Modal>
    <Drawer footer={<Button className="w-full" onClick={() => setDrawerOpen(false)}>Save changes</Button>} onClose={() => setDrawerOpen(false)} open={drawerOpen} title="Edit stock record"><Input label="Item name" value="Rice flour" readOnly /></Drawer>
  </main>;
}
