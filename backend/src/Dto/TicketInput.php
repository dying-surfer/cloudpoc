<?php

declare(strict_types=1);

namespace App\Dto;

use App\Enum\TicketPriority;
use App\Enum\TicketStatus;
use Symfony\Component\Serializer\Attribute\Context;
use Symfony\Component\Serializer\Normalizer\DateTimeNormalizer;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Request body of POST and PUT /api/tickets. PUT replaces the whole ticket:
 * fields that are left out are reset to their defaults.
 */
final class TicketInput
{
    public function __construct(
        #[Assert\NotBlank]
        #[Assert\Length(max: 200)]
        public string $title = '',
        #[Assert\Length(max: 10000)]
        public ?string $description = null,
        public TicketStatus $status = TicketStatus::Open,
        public TicketPriority $priority = TicketPriority::Medium,
        #[Assert\Length(max: 100)]
        public ?string $assignee = null,
        /** YYYY-MM-DD */
        #[Context([DateTimeNormalizer::FORMAT_KEY => '!Y-m-d'])]
        public ?\DateTimeImmutable $dueDate = null,
        /** Required on PUT: the version you last read (optimistic locking). Ignored on POST. */
        #[Assert\NotNull(groups: ['update'])]
        public ?int $version = null,
    ) {
    }
}
