# Demo task: bench_probe

In this repo create `bench_probe.py` containing a single function:

```python
def probe_add(a, b):
    return a + b
```

Then add 3 unit tests for it using Python's `unittest` module (a `unittest.TestCase` subclass):

1. `test_assert_equal` — asserts `probe_add(2, 3) == 5`.
2. `test_negative_inputs` — asserts `probe_add(-1, -2) == -3` and `probe_add(5, -8) == -3`.
3. `test_big_ints` — asserts `probe_add(10**18, 10**18) == 2 * 10**18`.

The tests must be runnable with `python -m unittest bench_probe -v` from the repo root and
must pass. Put both the function and the tests in the same `bench_probe.py` file.

Do not modify anything else and do not create any other files.
