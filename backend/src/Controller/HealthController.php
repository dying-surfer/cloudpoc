<?php

declare(strict_types=1);

namespace App\Controller;

use Doctrine\DBAL\Connection;
use OpenApi\Attributes as OA;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Probes for the platform (Kubernetes, Compose healthchecks, load balancers).
 *
 * Liveness only says "the process can answer requests" and must not depend on the
 * database: otherwise a DB outage would make Kubernetes restart every backend pod.
 * Readiness includes the DB, so a pod without DB gets no traffic but stays alive.
 */
#[AsController]
#[OA\Tag(name: 'Health')]
final class HealthController
{
    #[Route('/healthz', name: 'healthz', methods: ['GET'])]
    #[OA\Response(response: 200, description: 'Process is alive')]
    public function liveness(): JsonResponse
    {
        return new JsonResponse(['status' => 'ok']);
    }

    #[Route('/readyz', name: 'readyz', methods: ['GET'])]
    #[OA\Response(response: 200, description: 'Ready to serve traffic')]
    #[OA\Response(response: 503, description: 'A dependency (database) is not available')]
    public function readiness(Connection $connection, LoggerInterface $logger): JsonResponse
    {
        try {
            $connection->executeQuery('SELECT 1');
        } catch (\Throwable $e) {
            $logger->warning('Readiness check failed: database unavailable', ['exception' => $e]);

            return new JsonResponse(
                ['status' => 'unavailable', 'checks' => ['database' => 'unavailable']],
                Response::HTTP_SERVICE_UNAVAILABLE,
            );
        }

        return new JsonResponse(['status' => 'ok', 'checks' => ['database' => 'ok']]);
    }
}
