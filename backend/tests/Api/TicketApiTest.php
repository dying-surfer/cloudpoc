<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Enum\TicketPriority;
use App\Enum\TicketStatus;
use App\Fixtures\Factory\TicketFactory;

final class TicketApiTest extends ApiTestCase
{
    // --- List ----------------------------------------------------------------

    public function testListIsPaged(): void
    {
        TicketFactory::createMany(25);

        $page = $this->request('GET', '/api/tickets?page=2&pageSize=10');

        self::assertResponseIsSuccessful();
        self::assertSame(25, $page['total']);
        self::assertSame(2, $page['page']);
        self::assertSame(10, $page['pageSize']);
        self::assertCount(10, $this->items($page));
    }

    public function testPagesDoNotOverlap(): void
    {
        // Equal sort keys everywhere: only the id tie-breaker keeps pages stable.
        TicketFactory::createMany(12, ['priority' => TicketPriority::Medium]);

        $ids = [];
        foreach ([1, 2, 3] as $p) {
            $ids = [...$ids, ...$this->column($this->request('GET', "/api/tickets?sort=priority&pageSize=5&page=$p"), 'id')];
        }

        self::assertCount(12, $ids);
        self::assertCount(12, array_unique($ids));
    }

    public function testFilterByStatusPriorityAndAssignee(): void
    {
        TicketFactory::createOne(['title' => 'match', 'status' => TicketStatus::Open, 'priority' => TicketPriority::High, 'assignee' => 'anna']);
        TicketFactory::createOne(['title' => 'wrong status', 'status' => TicketStatus::Done, 'priority' => TicketPriority::High, 'assignee' => 'anna']);
        TicketFactory::createOne(['title' => 'wrong priority', 'status' => TicketStatus::Open, 'priority' => TicketPriority::Low, 'assignee' => 'anna']);
        TicketFactory::createOne(['title' => 'wrong assignee', 'status' => TicketStatus::Open, 'priority' => TicketPriority::High, 'assignee' => 'ben']);

        $page = $this->request('GET', '/api/tickets?status=open&priority=high&assignee=anna');

        self::assertSame(['match'], $this->column($page, 'title'));
        self::assertSame(1, $page['total']);
    }

    public function testSearchIsCaseInsensitiveOverTitleAndDescription(): void
    {
        TicketFactory::createOne(['title' => 'Drucker defekt', 'description' => null]);
        TicketFactory::createOne(['title' => 'Monitor', 'description' => 'Steht neben dem DRUCKER']);
        TicketFactory::createOne(['title' => 'Kaffeemaschine', 'description' => 'nichts']);

        $page = $this->request('GET', '/api/tickets?q=drucker&sort=title');

        self::assertSame(['Drucker defekt', 'Monitor'], $this->column($page, 'title'));
    }

    public function testSearchTreatsLikeWildcardsLiterally(): void
    {
        TicketFactory::createOne(['title' => 'Rabatt 100% falsch', 'description' => null]);
        TicketFactory::createOne(['title' => 'Rabatt 1000 falsch', 'description' => null]);

        $page = $this->request('GET', '/api/tickets?q='.urlencode('100%'));

        self::assertSame(['Rabatt 100% falsch'], $this->column($page, 'title'));
    }

    public function testDueBeforeIsExclusiveAndSkipsTicketsWithoutDueDate(): void
    {
        TicketFactory::createOne(['title' => 'early', 'dueDate' => new \DateTimeImmutable('2030-01-09')]);
        TicketFactory::createOne(['title' => 'same day', 'dueDate' => new \DateTimeImmutable('2030-01-10')]);
        TicketFactory::createOne(['title' => 'no date', 'dueDate' => null]);

        $page = $this->request('GET', '/api/tickets?dueBefore=2030-01-10');

        self::assertSame(['early'], $this->column($page, 'title'));
    }

    public function testSortByPriorityUsesMeaningNotAlphabet(): void
    {
        TicketFactory::createOne(['priority' => TicketPriority::Medium]);
        TicketFactory::createOne(['priority' => TicketPriority::High]);
        TicketFactory::createOne(['priority' => TicketPriority::Low]);

        self::assertSame(['low', 'medium', 'high'], $this->column($this->request('GET', '/api/tickets?sort=priority'), 'priority'));
        self::assertSame(['high', 'medium', 'low'], $this->column($this->request('GET', '/api/tickets?sort=-priority'), 'priority'));
    }

    public function testInvalidQueryParametersAreRejected(): void
    {
        $body = $this->request('GET', '/api/tickets?sort=nope&pageSize=500');

        $this->assertProblem(400, $body);
        self::assertEqualsCanonicalizing(['sort', 'pageSize'], $this->violationFields($body));
    }

    public function testInvalidDueBeforeIsRejected(): void
    {
        $this->assertProblem(400, $this->request('GET', '/api/tickets?dueBefore=2030-13-01'));
    }

    public function testInvalidEnumValueListsAllowedValues(): void
    {
        $body = $this->request('GET', '/api/tickets?status=wip');

        $this->assertProblem(400, $body);
        self::assertSame([['field' => 'status', 'message' => 'Allowed values: "open", "in_progress", "done".']], $body['violations']);
    }

    // --- Read ----------------------------------------------------------------

    public function testGetReturnsTicket(): void
    {
        $ticket = TicketFactory::createOne([
            'title' => 'VPN',
            'status' => TicketStatus::InProgress,
            'dueDate' => new \DateTimeImmutable('2030-05-01'),
        ]);

        $body = $this->request('GET', '/api/tickets/'.$ticket->getId());

        self::assertResponseIsSuccessful();
        self::assertSame((string) $ticket->getId(), $body['id']);
        self::assertSame('VPN', $body['title']);
        self::assertSame('in_progress', $body['status']);
        self::assertSame('2030-05-01', $body['dueDate']);
        self::assertSame(1, $body['version']);
    }

    public function testGetUnknownTicketIs404(): void
    {
        $this->assertProblem(404, $this->request('GET', '/api/tickets/0199a0a0-0000-7000-8000-000000000000'));
    }

    // --- Create --------------------------------------------------------------

    public function testCreateAppliesDefaults(): void
    {
        $body = $this->request('POST', '/api/tickets', ['title' => 'Neues Ticket']);

        self::assertResponseStatusCodeSame(201);
        self::assertResponseHeaderSame('Location', '/api/tickets/'.$body['id']);
        self::assertSame('open', $body['status']);
        self::assertSame('medium', $body['priority']);
        self::assertNull($body['dueDate']);
        self::assertSame(1, $body['version']);

        $this->request('GET', '/api/tickets/'.$body['id']);
        self::assertResponseIsSuccessful();
    }

    public function testCreateValidatesInput(): void
    {
        $body = $this->request('POST', '/api/tickets', ['title' => '', 'assignee' => str_repeat('x', 101)]);

        $this->assertProblem(422, $body);
        self::assertEqualsCanonicalizing(['title', 'assignee'], $this->violationFields($body));
    }

    public function testCreateRejectsInvalidTypes(): void
    {
        $body = $this->request('POST', '/api/tickets', ['title' => 'x', 'priority' => 'urgent', 'dueDate' => '01.02.2030']);

        $this->assertProblem(422, $body);
        self::assertEqualsCanonicalizing(['priority', 'dueDate'], $this->violationFields($body));
    }

    public function testCreateReportsAllErrorsAtOnce(): void
    {
        // Invalid enum and date values must not hide the other validation errors.
        $body = $this->request('POST', '/api/tickets', ['title' => '', 'status' => 'wip', 'dueDate' => '01.02.2030']);

        $this->assertProblem(422, $body);
        self::assertEqualsCanonicalizing(['title', 'status', 'dueDate'], $this->violationFields($body));
    }

    public function testCreateRejectsImpossibleCalendarDate(): void
    {
        // PHP would silently roll 2030-02-31 over to 2030-03-03.
        $body = $this->request('POST', '/api/tickets', ['title' => 'x', 'dueDate' => '2030-02-31']);

        $this->assertProblem(422, $body);
        self::assertSame([['field' => 'dueDate', 'message' => 'Expected a valid date in the format YYYY-MM-DD.']], $body['violations']);
    }

    public function testCreateRejectsMalformedJson(): void
    {
        $this->client->request('POST', '/api/tickets', server: ['CONTENT_TYPE' => 'application/json'], content: '{kaputt');

        $body = json_decode((string) $this->client->getResponse()->getContent(), true);
        self::assertIsArray($body);
        /* @var array<string, mixed> $body */
        $this->assertProblem(400, $body);
    }

    // --- Update (optimistic locking) -----------------------------------------

    public function testUpdateReplacesTicketAndIncrementsVersion(): void
    {
        $ticket = TicketFactory::createOne(['assignee' => 'anna']);

        $body = $this->request('PUT', '/api/tickets/'.$ticket->getId(), [
            'title' => 'Geändert',
            'status' => 'in_progress',
            'version' => 1,
        ]);

        self::assertResponseIsSuccessful();
        self::assertSame('Geändert', $body['title']);
        self::assertSame('in_progress', $body['status']);
        self::assertNull($body['assignee'], 'PUT replaces the whole ticket: omitted fields are reset');
        self::assertSame(2, $body['version']);
    }

    public function testUpdateWithStaleVersionIsConflict(): void
    {
        $ticket = TicketFactory::createOne(['title' => 'Original']);
        $uri = '/api/tickets/'.$ticket->getId();

        // Two clients both read version 1; the first one saves successfully …
        $this->request('PUT', $uri, ['title' => 'Erster', 'version' => 1]);
        self::assertResponseIsSuccessful();

        // … the second one must not overwrite that change.
        $this->assertProblem(409, $this->request('PUT', $uri, ['title' => 'Zweiter', 'version' => 1]));
        self::assertSame('Erster', $this->request('GET', $uri)['title']);
    }

    public function testUpdateRequiresVersion(): void
    {
        $ticket = TicketFactory::createOne();

        $body = $this->request('PUT', '/api/tickets/'.$ticket->getId(), ['title' => 'ohne Version']);

        $this->assertProblem(422, $body);
        self::assertSame(['version'], $this->violationFields($body));
    }

    public function testUpdateUnknownTicketIs404(): void
    {
        $this->assertProblem(404, $this->request('PUT', '/api/tickets/0199a0a0-0000-7000-8000-000000000000', ['title' => 'x', 'version' => 1]));
    }

    // --- Close & delete ------------------------------------------------------

    public function testCloseSetsStatusDoneAndIsIdempotent(): void
    {
        $ticket = TicketFactory::createOne(['status' => TicketStatus::Open]);
        $uri = '/api/tickets/'.$ticket->getId().'/close';

        self::assertSame('done', $this->request('POST', $uri)['status']);
        self::assertResponseIsSuccessful();

        self::assertSame('done', $this->request('POST', $uri)['status']);
        self::assertResponseIsSuccessful();
    }

    public function testDeleteRemovesTicket(): void
    {
        $ticket = TicketFactory::createOne();
        $uri = '/api/tickets/'.$ticket->getId();

        $this->request('DELETE', $uri);
        self::assertResponseStatusCodeSame(204);

        $this->assertProblem(404, $this->request('GET', $uri));
        $this->assertProblem(404, $this->request('DELETE', $uri));
    }

    // --- Helpers -------------------------------------------------------------

    /**
     * @param array<string, mixed> $page
     *
     * @return list<array<string, mixed>>
     */
    private function items(array $page): array
    {
        self::assertIsList($page['items'] ?? null);

        /* @var list<array<string, mixed>> */
        return $page['items'];
    }

    /**
     * @param array<string, mixed> $page
     *
     * @return list<mixed>
     */
    private function column(array $page, string $key): array
    {
        return array_column($this->items($page), $key);
    }
}
