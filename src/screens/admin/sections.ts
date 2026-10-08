import { printerSection } from './PrinterSection';
import { qualitySection } from './QualitySection';
import { sharingSection } from './SharingSection';
import { appearanceSection } from './AppearanceSection';
import { securitySection } from './SecuritySection';
import type { SectionDef } from './types';

/**
 * The settings map. To add a setting: put it in the card it belongs to (or add a CardDef to a section).
 * To add a category: create a SectionDef file and list it here. Navigation, mobile menu and search pick it up automatically.
 */
export const SECTIONS: SectionDef[] = [printerSection, qualitySection, sharingSection, appearanceSection, securitySection];
