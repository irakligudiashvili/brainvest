// Local furniture catalogue that supplements DummyJSON (which has only five
// furniture items). Products use the same shape as DummyJSON so the rest of the
// app treats them identically. Photos are CC0 — see public/catalog/CREDITS.md.
// Names, prices and descriptions are placeholder data for the staging mockup.

const img = (file) => `${import.meta.env.BASE_URL}catalog/${file}.jpg`;

const DEFAULTS = {
  category: 'furniture',
  brand: 'Hearth & Oak',
  warrantyInformation: '10 year frame warranty',
  shippingInformation: 'Delivered and assembled in 1–2 weeks',
  returnPolicy: '30 days return policy',
  reviews: [],
};

const RAW = [
  // ── Sofas & couches ──
  { id: 1001, tags: ['furniture', 'sofas'], file: 'chesterfield-leather-sofa', title: 'Chesterfield Leather Sofa', price: 2299, discountPercentage: 15, rating: 4.8, stock: 6, dims: [220, 78, 95], weight: 85,
    description: 'A deep-buttoned three-seater sofa in black full-grain leather with rolled arms. A statement couch for the living room or study that softens beautifully with age.' },
  { id: 1002, tags: ['furniture', 'sofas'], file: 'nordic-3-seater-sofa', title: 'Nordic 3-Seater Sofa, Light Grey', price: 1149, discountPercentage: 10, rating: 4.6, stock: 14, dims: [205, 84, 90], weight: 52,
    description: 'Clean-lined three-seater sofa with tapered wooden legs and a soft woven fabric. Removable cushion covers make this everyday living room couch easy to keep fresh.' },
  { id: 1003, tags: ['furniture', 'sofas'], file: 'alba-white-2-seater-sofa', title: 'Alba White 2-Seater Sofa', price: 899, discountPercentage: 5, rating: 4.4, stock: 9, dims: [168, 80, 88], weight: 40,
    description: 'Compact two-seater sofa in white faux leather with generous cushions. Sized for smaller living rooms and apartments without giving up comfort.' },
  { id: 1004, tags: ['furniture', 'sofas', 'armchairs'], file: 'bianca-lounge-sofa-set', title: 'Bianca Lounge Sofa Set', price: 3199, discountPercentage: 18, rating: 4.7, stock: 4, dims: [240, 82, 96], weight: 120,
    description: 'A matching sofa and armchair set in soft ivory upholstery. Everything you need to furnish a bright, relaxed living room in one order.' },
  { id: 1005, tags: ['furniture', 'sofas'], file: 'velvet-sofa-royal-blue', title: 'Velvet Sofa, Royal Blue', price: 1349, discountPercentage: 12, rating: 4.5, stock: 7, dims: [198, 82, 92], weight: 55,
    description: 'Rich royal-blue velvet sofa with a low profile and slim arms. A bold colour accent for a modern living room.' },

  // ── Armchairs & chairs ──
  { id: 1006, tags: ['furniture', 'armchairs'], file: 'mustard-lounge-chairs', title: 'Mustard Lounge Chair (Pair)', price: 749, discountPercentage: 20, rating: 4.3, stock: 11, dims: [72, 76, 78], weight: 24,
    description: 'Two mid-century lounge chairs in mustard fabric on a slim black frame. Pair them around a coffee table for an easy conversation corner.' },
  { id: 1007, tags: ['furniture', 'armchairs'], file: 'regent-tufted-armchair', title: 'Regent Tufted Armchair', price: 979, discountPercentage: 8, rating: 4.6, stock: 5, dims: [80, 105, 82], weight: 30,
    description: 'Classic high-back armchair with deep button tufting and carved wooden feet. A comfortable reading chair with real presence.' },
  { id: 1008, tags: ['furniture', 'armchairs'], file: 'vintage-wingback-armchair', title: 'Vintage Wingback Armchair', price: 689, discountPercentage: 14, rating: 4.2, stock: 8, dims: [76, 102, 80], weight: 26,
    description: 'Traditional wingback armchair in a warm, worn-look fabric with a solid timber frame. Built for long evenings with a book.' },
  { id: 1009, tags: ['furniture', 'armchairs'], file: 'cloud-white-armchair', title: 'Cloud White Armchair', price: 599, discountPercentage: 6, rating: 4.5, stock: 13, dims: [78, 98, 84], weight: 22,
    description: 'Soft, high-backed armchair in washable white upholstery. Light enough to move between the living room and the bedroom.' },
  { id: 1010, tags: ['furniture', 'chairs'], file: 'windsor-spindle-chair', title: 'Windsor Spindle Chair, Black', price: 189, discountPercentage: 10, rating: 4.1, stock: 32, dims: [45, 92, 50], weight: 6,
    description: 'A timeless spindle-back chair in black-stained solid wood. Works as a dining chair or a desk chair in a home office.' },

  // ── Beds ──
  { id: 1011, tags: ['furniture', 'beds'], file: 'haven-upholstered-bed', title: 'Haven Upholstered Double Bed', price: 1099, discountPercentage: 12, rating: 4.7, stock: 10, dims: [150, 110, 210], weight: 68,
    description: 'Double bed with a padded fabric headboard and a sturdy slatted base. A calm, comfortable centrepiece for the bedroom. Mattress sold separately.' },
  { id: 1012, tags: ['furniture', 'beds'], file: 'tufted-headboard-king-bed', title: 'Tufted Headboard King Bed', price: 1599, discountPercentage: 15, rating: 4.8, stock: 6, dims: [190, 125, 215], weight: 82,
    description: 'King-size bed with a tall button-tufted white headboard. Hotel-style comfort for the main bedroom. Mattress sold separately.' },
  { id: 1013, tags: ['furniture', 'beds'], file: 'plum-panel-double-bed', title: 'Panel Double Bed, Plum', price: 949, discountPercentage: 9, rating: 4.3, stock: 9, dims: [155, 100, 208], weight: 60,
    description: 'Double bed with a smooth panel headboard upholstered in deep plum. Pairs well with darker bedroom colour schemes.' },
  { id: 1014, tags: ['furniture', 'beds', 'desks'], file: 'studio-bed-desk-combo', title: 'Studio Bed with Desk Unit', price: 1449, discountPercentage: 20, rating: 4.4, stock: 5, dims: [200, 180, 95], weight: 110,
    description: 'Space-saving single bed with built-in storage, wall shelving and a desk. Ideal for a teenager’s bedroom or a compact studio flat.' },

  // ── Tables & desks ──
  { id: 1015, tags: ['furniture', 'dining tables', 'chairs'], file: 'oslo-dining-set', title: 'Oslo Dining Set (Table + 2 Chairs)', price: 549, discountPercentage: 10, rating: 4.5, stock: 15, dims: [90, 75, 90], weight: 35,
    description: 'A white square dining table with two moulded chairs on wooden legs. Just right for a kitchen corner or a small dining room.' },
  { id: 1016, tags: ['furniture', 'dining tables'], file: 'rustic-oak-dining-table', title: 'Rustic Oak Dining Table', price: 1249, discountPercentage: 7, rating: 4.7, stock: 6, dims: [180, 76, 90], weight: 70,
    description: 'Solid oak dining table with a natural, hand-finished top that seats six. Made to be the heart of the dining room for years.' },
  { id: 1017, tags: ['furniture', 'dining tables'], file: 'harvest-walnut-dining-table', title: 'Harvest Dining Table, Walnut', price: 1399, discountPercentage: 13, rating: 4.6, stock: 4, dims: [200, 76, 95], weight: 78,
    description: 'A long walnut-finish dining table with a plank-style top and four matching upholstered chairs available separately.' },
  { id: 1018, tags: ['furniture', 'coffee tables'], file: 'lumi-gloss-coffee-table', title: 'Lumi Gloss Coffee Table', price: 329, discountPercentage: 16, rating: 4.2, stock: 18, dims: [110, 40, 60], weight: 21,
    description: 'Low white high-gloss coffee table with a lower shelf for magazines and remotes. Brightens up any living room.' },
  { id: 1019, tags: ['furniture', 'desks'], file: 'minimal-writing-desk', title: 'Minimal Writing Desk', price: 279, discountPercentage: 5, rating: 4.4, stock: 22, dims: [110, 75, 55], weight: 18,
    description: 'Slim white writing desk with light wooden legs — a tidy, uncluttered workspace for the home office.' },
];

export const LOCAL_PRODUCTS = RAW.map(({ file, dims, ...p }) => ({
  ...DEFAULTS,
  ...p,
  sku: `HO-${p.id}`,
  thumbnail: img(file),
  images: [img(file)],
  availabilityStatus: p.stock > 10 ? 'In Stock' : 'Low Stock',
  dimensions: { width: dims[0], height: dims[1], depth: dims[2] },
}));

export const localProduct = (id) => LOCAL_PRODUCTS.find((p) => p.id === Number(id));
