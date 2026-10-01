<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\TicketListQuery;
use App\Dto\TicketPage;
use App\Dto\TicketView;
use App\Entity\Ticket;
use App\Repository\TicketRepository;
use Nelmio\ApiDocBundle\Attribute\Model;
use OpenApi\Attributes as OA;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapQueryString;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Routing\Requirement\Requirement;
use Symfony\Component\Uid\Uuid;

#[Route('/api/tickets')]
#[OA\Tag(name: 'Tickets')]
final class TicketController extends AbstractController
{
    public function __construct(
        private readonly TicketRepository $tickets,
    ) {
    }

    #[Route('', name: 'ticket_list', methods: ['GET'])]
    #[OA\Response(response: 200, description: 'One page of tickets', content: new Model(type: TicketPage::class))]
    #[OA\Response(response: 400, description: 'Invalid query parameters (Problem Details)')]
    public function list(
        #[MapQueryString(validationFailedStatusCode: 400)]
        TicketListQuery $query = new TicketListQuery(),
    ): JsonResponse {
        [$tickets, $total] = $this->tickets->search($query);

        return $this->json(new TicketPage(
            items: array_map(TicketView::fromEntity(...), $tickets),
            total: $total,
            page: $query->page,
            pageSize: $query->pageSize,
        ));
    }

    #[Route('/{id}', name: 'ticket_get', requirements: ['id' => Requirement::UUID], methods: ['GET'])]
    #[OA\Response(response: 200, description: 'The ticket', content: new Model(type: TicketView::class))]
    #[OA\Response(response: 404, description: 'Ticket not found (Problem Details)')]
    public function get(Uuid $id): JsonResponse
    {
        return $this->json(TicketView::fromEntity($this->findOr404($id)));
    }

    private function findOr404(Uuid $id): Ticket
    {
        return $this->tickets->find($id) ?? throw new NotFoundHttpException(\sprintf('Ticket %s not found.', $id));
    }
}
