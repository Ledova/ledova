import resource
from pathlib import Path

ADDRESS_SPACE_REFUSED = "address-space-refused"


def apply_limits(memory_bytes, cpu_seconds, file_bytes):
    if any(type(value) is not int or value < 1 for value in (memory_bytes, cpu_seconds, file_bytes)):
        raise ValueError("upload worker limits must be positive integers")
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    try:
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    except ValueError:
        hard = resource.getrlimit(resource.RLIMIT_AS)[1]
        if hard != resource.RLIM_INFINITY and memory_bytes > hard:
            raise
        Path(ADDRESS_SPACE_REFUSED).touch()
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    resource.setrlimit(resource.RLIMIT_FSIZE, (file_bytes, file_bytes))
