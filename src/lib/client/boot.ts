import Alpine from 'alpinejs';
import { registerUiStores } from './ui';
import { eventsBoard } from './events-board';
import { staffPage } from './staff-page';
import { listBuilder } from './list-builder';
import { staffListBuilder } from './staff-list-builder';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).Alpine = Alpine;

registerUiStores();
Alpine.data('eventsBoard', eventsBoard);
Alpine.data('staffPage', staffPage);
Alpine.data('listBuilder', listBuilder);
Alpine.data('staffListBuilder', staffListBuilder);

Alpine.start();
