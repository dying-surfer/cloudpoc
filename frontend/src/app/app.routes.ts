import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tickets' },
  {
    path: 'tickets',
    title: 'Tickets · cloudpoc',
    loadComponent: () => import('./tickets/ticket-list'),
  },
  // "new" vor ":id", sonst würde "new" als id gelesen.
  {
    path: 'tickets/new',
    title: 'Neues Ticket · cloudpoc',
    loadComponent: () => import('./tickets/ticket-detail'),
  },
  {
    path: 'tickets/:id',
    title: 'Ticket · cloudpoc',
    loadComponent: () => import('./tickets/ticket-detail'),
  },
  { path: '**', redirectTo: 'tickets' },
];
