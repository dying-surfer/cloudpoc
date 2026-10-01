<?php

declare(strict_types=1);

namespace App\Repository;

use App\Dto\TicketListQuery;
use App\Entity\Ticket;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\ORM\QueryBuilder;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<Ticket>
 */
class TicketRepository extends ServiceEntityRepository
{
    // Enums are stored as strings; sorting them alphabetically would give
    // "high, low, medium". These CASE expressions sort by meaning instead.
    private const SORT_EXPRESSIONS = [
        'status' => "CASE t.status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END",
        'priority' => "CASE t.priority WHEN 'low' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END",
    ];

    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Ticket::class);
    }

    /**
     * @return array{list<Ticket>, int} the tickets of the requested page and the total count
     */
    public function search(TicketListQuery $query): array
    {
        $total = (int) $this->filtered($query)
            ->select('COUNT(t.id)')
            ->getQuery()
            ->getSingleScalarResult();

        $qb = $this->filtered($query)
            ->setFirstResult(($query->page - 1) * $query->pageSize)
            ->setMaxResults($query->pageSize);

        $direction = str_starts_with($query->sort, '-') ? 'DESC' : 'ASC';
        $field = ltrim($query->sort, '-');
        if (isset(self::SORT_EXPRESSIONS[$field])) {
            $qb->addSelect(self::SORT_EXPRESSIONS[$field].' AS HIDDEN sortKey')->orderBy('sortKey', $direction);
        } else {
            $qb->orderBy('t.'.$field, $direction);
        }
        // Tie-breaker: without a unique last sort key, rows could jump between pages.
        $qb->addOrderBy('t.id', $direction);

        /** @var list<Ticket> $tickets */
        $tickets = $qb->getQuery()->getResult();

        return [$tickets, $total];
    }

    private function filtered(TicketListQuery $query): QueryBuilder
    {
        $qb = $this->createQueryBuilder('t');

        if (null !== $query->q && '' !== trim($query->q)) {
            // Escape LIKE wildcards so a search for "100%" finds exactly that.
            $needle = '%'.addcslashes(mb_strtolower(trim($query->q)), '%_\\').'%';
            $qb->andWhere('LOWER(t.title) LIKE :q OR LOWER(t.description) LIKE :q')
                ->setParameter('q', $needle);
        }
        if (null !== $query->status) {
            $qb->andWhere('t.status = :status')->setParameter('status', $query->status);
        }
        if (null !== $query->priority) {
            $qb->andWhere('t.priority = :priority')->setParameter('priority', $query->priority);
        }
        if (null !== $query->assignee) {
            $qb->andWhere('t.assignee = :assignee')->setParameter('assignee', $query->assignee);
        }
        if (null !== $query->dueBefore) {
            $qb->andWhere('t.dueDate < :dueBefore')->setParameter('dueBefore', $query->dueBefore, 'date_immutable');
        }

        return $qb;
    }
}
