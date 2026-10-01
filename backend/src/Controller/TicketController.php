<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\TicketInput;
use App\Dto\TicketListQuery;
use App\Dto\TicketPage;
use App\Dto\TicketUpdateInput;
use App\Dto\TicketView;
use App\Entity\Ticket;
use App\Repository\TicketRepository;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Nelmio\ApiDocBundle\Attribute\Model;
use OpenApi\Attributes as OA;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapQueryString;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
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
        private readonly EntityManagerInterface $em,
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

    #[Route('', name: 'ticket_create', methods: ['POST'])]
    #[OA\Response(response: 201, description: 'Ticket created', content: new Model(type: TicketView::class))]
    #[OA\Response(response: 422, description: 'Invalid request body (Problem Details with violations)')]
    public function create(#[MapRequestPayload] TicketInput $input): JsonResponse
    {
        $ticket = new Ticket($input->title);
        $this->apply($ticket, $input);
        $this->em->persist($ticket);
        $this->em->flush();

        return $this->json(TicketView::fromEntity($ticket), Response::HTTP_CREATED, [
            'Location' => $this->generateUrl('ticket_get', ['id' => $ticket->getId()]),
        ]);
    }

    #[Route('/{id}', name: 'ticket_update', requirements: ['id' => Requirement::UUID], methods: ['PUT'])]
    #[OA\Response(response: 200, description: 'Ticket updated', content: new Model(type: TicketView::class))]
    #[OA\Response(response: 404, description: 'Ticket not found (Problem Details)')]
    #[OA\Response(response: 409, description: 'Ticket was changed in the meantime: reload and retry (Problem Details)')]
    #[OA\Response(response: 422, description: 'Invalid request body (Problem Details with violations)')]
    public function update(
        Uuid $id,
        #[MapRequestPayload]
        TicketUpdateInput $input,
    ): JsonResponse {
        $ticket = $this->findOr404($id);

        // Fails right away if the client edited an outdated version. If someone else
        // updates the row between this check and flush(), Doctrine's "WHERE version = ?"
        // catches it. Both throw an OptimisticLockException, rendered as 409.
        $this->em->lock($ticket, LockMode::OPTIMISTIC, $input->version);

        $this->apply($ticket, $input);
        $this->em->flush();

        return $this->json(TicketView::fromEntity($ticket));
    }

    #[Route('/{id}', name: 'ticket_delete', requirements: ['id' => Requirement::UUID], methods: ['DELETE'])]
    #[OA\Response(response: 204, description: 'Ticket deleted')]
    #[OA\Response(response: 404, description: 'Ticket not found (Problem Details)')]
    public function delete(Uuid $id): Response
    {
        $this->em->remove($this->findOr404($id));
        $this->em->flush();

        return new Response(status: Response::HTTP_NO_CONTENT);
    }

    /**
     * RPC-style action: closing is a domain operation, not a field update, so the
     * client does not need to send the whole ticket. Closing a closed ticket is a no-op.
     */
    #[Route('/{id}/close', name: 'ticket_close', requirements: ['id' => Requirement::UUID], methods: ['POST'])]
    #[OA\Response(response: 200, description: 'Ticket closed (status "done")', content: new Model(type: TicketView::class))]
    #[OA\Response(response: 404, description: 'Ticket not found (Problem Details)')]
    public function close(Uuid $id): JsonResponse
    {
        $ticket = $this->findOr404($id);
        $ticket->close();
        $this->em->flush();

        return $this->json(TicketView::fromEntity($ticket));
    }

    private function apply(Ticket $ticket, TicketInput $input): void
    {
        $ticket
            ->setTitle($input->title)
            ->setDescription($input->description)
            ->setStatus($input->statusEnum())
            ->setPriority($input->priorityEnum())
            ->setAssignee($input->assignee)
            ->setDueDate($input->dueDateObject());
    }

    private function findOr404(Uuid $id): Ticket
    {
        return $this->tickets->find($id) ?? throw new NotFoundHttpException(\sprintf('Ticket %s not found.', $id));
    }
}
