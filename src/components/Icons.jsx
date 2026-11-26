// Simple stroke icons (24×24). Size and colour follow the surrounding text.
const Svg = ({ children, size = 20, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

export const SearchIcon = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>;
export const CartIcon = (p) => <Svg {...p}><path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></Svg>;
export const BagIcon = (p) => <Svg {...p}><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></Svg>;
export const HeartIcon = ({ filled, ...p }) => <Svg {...p} fill={filled ? 'currentColor' : 'none'}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></Svg>;
export const UserIcon = (p) => <Svg {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></Svg>;
export const ClockIcon = (p) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>;
export const GlobeIcon = (p) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" /></Svg>;
export const StoreIcon = (p) => <Svg {...p}><path d="M4 10v9h16v-9M3 6l2-3h14l2 3v1.5a2.5 2.5 0 0 1-4.5 1.5 2.5 2.5 0 0 1-4.5 0 2.5 2.5 0 0 1-4.5 0A2.5 2.5 0 0 1 3 7.5V6Z" /><path d="M10 19v-5h4v5" /></Svg>;
export const StarIcon = (p) => <Svg {...p}><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" /></Svg>;
export const ShieldIcon = (p) => <Svg {...p}><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></Svg>;
export const TruckIcon = (p) => <Svg {...p}><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17.5" cy="18" r="1.8" /></Svg>;
export const PercentIcon = (p) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m9 15 6-6" /><circle cx="9.5" cy="9.5" r=".8" /><circle cx="14.5" cy="14.5" r=".8" /></Svg>;
export const CardIcon = (p) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></Svg>;
export const ChevronDown = (p) => <Svg size={14} {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const ChevronLeft = (p) => <Svg {...p}><path d="m15 18-6-6 6-6" /></Svg>;
export const ChevronRight = (p) => <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>;
export const ArrowRight = (p) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const ArrowLeft = (p) => <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
export const ChatIcon = (p) => <Svg {...p}><path d="M4 12a8 8 0 1 1 3.5 6.6L4 20l1.3-3.6A8 8 0 0 1 4 12Z" /></Svg>;
export const FilterIcon = (p) => <Svg {...p}><path d="M4 5h16l-6 7.5V19l-4 1v-7.5L4 5Z" /></Svg>;
export const ChevronUp = (p) => <Svg size={16} {...p}><path d="m6 15 6-6 6 6" /></Svg>;
export const CheckCircle = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16 10" /></Svg>;
export const QuoteIcon = (p) => <Svg {...p} fill="currentColor" stroke="none"><path d="M4 18v-5.5C4 8.4 6 6 9.5 5l.7 1.6C8 7.5 7.2 9 7.2 11H10v7H4Zm10 0v-5.5c0-4.1 2-6.5 5.5-7.5l.7 1.6C18 7.5 17.2 9 17.2 11H20v7h-6Z" /></Svg>;
