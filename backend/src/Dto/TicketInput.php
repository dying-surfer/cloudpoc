<?php

declare(strict_types=1);

namespace App\Dto;

use App\Enum\TicketPriority;
use App\Enum\TicketStatus;
use OpenApi\Attributes as OA;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Request body of POST /api/tickets (and base of the PUT body).
 *
 * Enum and date fields are plain strings checked by constraints, not PHP enums or
 * DateTime objects: a wrong value is then a normal validation error, reported
 * together with all other errors, instead of a type error that stops validation.
 * The typed accessors below may only be used after validation.
 */
class TicketInput
{
    #[Assert\NotBlank]
    #[Assert\Length(max: 200)]
    public string $title;

    #[Assert\Length(max: 10000)]
    public ?string $description = null;

    #[Assert\Choice(callback: [TicketStatus::class, 'values'], message: 'Allowed values: {{ choices }}.')]
    public string $status = TicketStatus::Open->value;

    #[Assert\Choice(callback: [TicketPriority::class, 'values'], message: 'Allowed values: {{ choices }}.')]
    public string $priority = TicketPriority::Medium->value;

    #[Assert\Length(max: 100)]
    public ?string $assignee = null;

    #[Assert\Date(message: 'Expected a valid date in the format YYYY-MM-DD.')]
    #[OA\Property(format: 'date', example: '2026-12-31')]
    public ?string $dueDate = null;

    public function statusEnum(): TicketStatus
    {
        return TicketStatus::from($this->status);
    }

    public function priorityEnum(): TicketPriority
    {
        return TicketPriority::from($this->priority);
    }

    public function dueDateObject(): ?\DateTimeImmutable
    {
        return null === $this->dueDate ? null : new \DateTimeImmutable($this->dueDate);
    }
}
