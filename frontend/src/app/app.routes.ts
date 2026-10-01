import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tickets' },
  {
    path: 'tickets',
    title: 'Tickets · cloudpoc',
    loadComponent: () => import('./tickets/ticket-list'),
  },
  { path: '**', redirectTo: 'tickets' },
];
