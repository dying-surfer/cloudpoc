<?php

declare(strict_types=1);

namespace App\EventListener;

use Doctrine\ORM\OptimisticLockException;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Validator\Exception\ValidationFailedException;

/**
 * Renders every exception under /api as Problem Details (RFC 9457).
 *
 * Priority -64: after Symfony's ErrorListener has logged the exception (priority 0),
 * but before it renders its own HTML/JSON error page (priority -128). Setting a
 * response stops propagation, so the default error page is never rendered.
 */
#[AsEventListener(event: KernelEvents::EXCEPTION, priority: -64)]
final class ProblemDetailsListener
{
    public function __construct(
        #[Autowire('%kernel.debug%')]
        private readonly bool $debug,
    ) {
    }

    public function __invoke(ExceptionEvent $event): void
    {
        if (!str_starts_with($event->getRequest()->getPathInfo(), '/api')) {
            return;
        }

        $exception = $event->getThrowable();
        if ($exception instanceof OptimisticLockException) {
            $exception = new ConflictHttpException('The resource was changed in the meantime. Reload it and apply your changes again.', $exception);
        }

        $status = Response::HTTP_INTERNAL_SERVER_ERROR;
        $headers = [];
        if ($exception instanceof HttpExceptionInterface) {
            $status = $exception->getStatusCode();
            $headers = $exception->getHeaders();
        }

        $problem = [
            'type' => 'about:blank',
            'title' => Response::$statusTexts[$status] ?? 'Error',
            'status' => $status,
        ];

        // Messages of HTTP exceptions are written for clients. Messages of other
        // exceptions may leak internals (SQL, paths), so they are shown only in debug.
        $detail = $exception->getMessage();
        if ('' !== $detail && ($exception instanceof HttpExceptionInterface || $this->debug)) {
            $problem['detail'] = $detail;
        }

        // #[MapRequestPayload] wraps validation errors in a 422 HttpException.
        $validation = $exception->getPrevious();
        if ($validation instanceof ValidationFailedException) {
            $problem['detail'] = 'The request data is invalid.';
            $problem['violations'] = [];
            foreach ($validation->getViolations() as $violation) {
                // Type errors during deserialization carry a client-safe "hint"
                // (e.g. "Allowed values: …"), which says more than the generic message.
                $hint = $violation->getParameters()['hint'] ?? null;
                $problem['violations'][] = [
                    'field' => $violation->getPropertyPath(),
                    'message' => \is_string($hint) ? $hint : $violation->getMessage(),
                ];
            }
        }

        $response = new JsonResponse($problem, $status, $headers);
        $response->setEncodingOptions(\JSON_UNESCAPED_SLASHES | \JSON_UNESCAPED_UNICODE);
        $response->headers->set('Content-Type', 'application/problem+json');
        $event->setResponse($response);
    }
}
