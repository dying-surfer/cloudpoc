<?php

declare(strict_types=1);

namespace App\Dto;

use App\Entity\Ticket;
use App\Enum\TicketPriority;
use App\Enum\TicketStatus;

/**
 * JSON representation of a ticket. Kept separate from the entity so the API
 * contract does not change by accident when the database model changes.
 */
final readonly class TicketView
{
    public function __construct(
        public string $id,
        public string $title,
        public ?string $description,
        public TicketStatus $status,
        public TicketPriority $priority,
        public ?string $assignee,
        /** YYYY-MM-DD */
        public ?string $dueDate,
        /** RFC 3339 */
        public string $createdAt,
        /** RFC 3339 */
        public string $updatedAt,
        /** Send this back on PUT (optimistic locking). */
        public int $version,
    ) {
    }

    public static function fromEntity(Ticket $ticket): self
    {
        return new self(
            id: $ticket->getId()->toRfc4122(),
            title: $ticket->getTitle(),
            description: $ticket->getDescription(),
            status: $ticket->getStatus(),
            priority: $ticket->getPriority(),
            assignee: $ticket->getAssignee(),
            dueDate: $ticket->getDueDate()?->format('Y-m-d'),
            createdAt: $ticket->getCreatedAt()->format(\DATE_RFC3339),
            updatedAt: $ticket->getUpdatedAt()->format(\DATE_RFC3339),
            version: $ticket->getVersion(),
        );
    }
}
