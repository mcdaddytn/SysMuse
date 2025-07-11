Feature 1

Logging enhancement

Let's instrument with some console.log for each api call, close to the input and upon successful completion.  

On the server side, after basic request parameters are established, log which api call has been called with whatever parameters can be logged.  Also log when the api call has been succesfully executed (by the end of the method).  It looks like errors are mostly logged already.

On the client side, add console.log calls before and after api calls are made.  
