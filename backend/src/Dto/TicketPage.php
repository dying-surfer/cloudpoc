<?php

declare(strict_types=1);

namespace App\Dto;

final readonly class TicketPage
{
    public function __construct(
        /** @var list<TicketView> */
        public array $items,
        /** Number of tickets matching the filters (all pages). */
        public int $total,
        public int $page,
        public int $pageSize,
    ) {
    }
}
