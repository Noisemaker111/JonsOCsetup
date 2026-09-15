import{acquireLock}from'../../quest/locking'
acquireLock(process.argv[2],'abandoned')
process.exit(0)
