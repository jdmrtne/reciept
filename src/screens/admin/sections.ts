import { eventsSection } from './EventSection';
import { layoutsSection } from './LayoutsSection';
import { framesSection } from './FramesSection';
import { frameTextSection } from './FrameTextSection';
import { printerSection } from './PrinterSection';
import { qualitySection } from './QualitySection';
import { sharingSection } from './SharingSection';
import { autoSaveSection } from './AutoSaveSection';
import { appearanceSection } from './AppearanceSection';
import { securitySection } from './SecuritySection';
import type { SectionDef } from './types';

/**
 * The settings map. To add a setting: put it in the card it belongs to (or add a CardDef to a section).
 * To add a category: create a SectionDef file and list it here. Navigation, mobile menu and search pick it up automatically.
 */
export const SECTIONS: SectionDef[] = [eventsSection, layoutsSection, framesSection, frameTextSection, printerSection, qualitySection, sharingSection, autoSaveSection, appearanceSection, securitySection];
